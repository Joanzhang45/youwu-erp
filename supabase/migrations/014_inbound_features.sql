-- 014：進貨功能補齊（2026-11-06，健檢功能缺口 A–D）
--
-- A. update_purchase_order()：修改採購單（日期、匯率、備註、品項數量／單價），總額由資料庫重算，一個交易完成。
--    取消採購單由前端直接更新 status_cancelled（受 RLS 管，且只允許尚未點收的單）。
--    集運單點收完成（status → 已驗收）時，trigger 自動把「所有集運批次都已點收」的採購單標成已到貨，
--    進貨清單上的單就會移到歷史區，不再越積越多。
-- B. create_consolidated_shipment()：從採購單品項建立集運批次（品項一定帶商品編號，點收時才會入庫存），
--    批號 CU-YYYYMMDD-NNN 由資料庫產生，同時把採購單標成運送中。
--    境內物流包裹由前端直接新增 domestic_logistics 一列（單表寫入，不需要函式）。
-- C. v_reorder_suggestions：補貨建議。最新訂單日往回 60 天的實際賣出（排除不成立單）算日均，
--    建議量 = 日均 ×（到貨天數 + 30 天備貨）− 目前庫存 − 已叫貨未到。到貨天數沒填用 21 天。
-- D. 到貨異常照片：私有儲存區 receiving-photos（只有白名單兩人能讀寫），
--    receiving_record_items.photo_path 記檔案路徑；receive_shipment() 改為一併寫入。

BEGIN;

-- A ───────────────────────────────────────────────
-- p: { "order_date": "YYYY-MM-DD", "cny_rate": 4.5, "notes": "...",
--      "items": [{ "id": poi.id, "qty": int, "unit_price_cny": numeric }] }   qty = 0 代表刪除該品項
CREATE OR REPLACE FUNCTION update_purchase_order(p_po_id bigint, p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  po purchase_orders%ROWTYPE;
  it jsonb;
  q int;
  price numeric;
  sub numeric;
  rate numeric;
BEGIN
  SELECT * INTO po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO_NOT_FOUND'; END IF;
  IF po.status_received OR po.status_cancelled THEN RAISE EXCEPTION 'PO_LOCKED'; END IF;

  rate := COALESCE(NULLIF(p ->> 'cny_rate', '')::numeric, po.cny_rate);
  IF rate IS NULL OR rate < 3 OR rate > 10 THEN RAISE EXCEPTION 'BAD_RATE'; END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p -> 'items', '[]'::jsonb)) LOOP
    q := (it ->> 'qty')::int;
    price := (it ->> 'unit_price_cny')::numeric;
    IF q IS NULL OR q < 0 OR price IS NULL OR price < 0 THEN RAISE EXCEPTION 'BAD_ITEM %', it; END IF;
    IF q = 0 THEN
      DELETE FROM purchase_order_items WHERE id = (it ->> 'id')::bigint AND po_id = p_po_id;
    ELSE
      UPDATE purchase_order_items
         SET qty = q, unit_price_cny = price, subtotal_cny = round(q * price, 4)
       WHERE id = (it ->> 'id')::bigint AND po_id = p_po_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_IN_PO %', it ->> 'id'; END IF;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM purchase_order_items WHERE po_id = p_po_id) THEN
    RAISE EXCEPTION 'NO_ITEMS_LEFT';
  END IF;

  SELECT round(COALESCE(sum(subtotal_cny), 0), 4) INTO sub FROM purchase_order_items WHERE po_id = p_po_id;

  -- 金額欄位慣例沿用新增採購單：subtotal／total_payment_cny／grand_total 都存人民幣小計，total_payment_ntd 才是台幣
  UPDATE purchase_orders
     SET order_date = COALESCE(NULLIF(p ->> 'order_date', '')::date, order_date),
         cny_rate = rate,
         notes = CASE WHEN p ? 'notes' THEN NULLIF(p ->> 'notes', '') ELSE notes END,
         subtotal_cny = sub, total_payment_cny = sub, grand_total = sub,
         total_payment_ntd = round(sub * rate, 2),
         updated_at = now()
   WHERE id = p_po_id;

  RETURN jsonb_build_object('subtotal_cny', sub, 'total_payment_ntd', round(sub * rate, 2));
END;
$$;

CREATE OR REPLACE FUNCTION trg_close_purchase_orders_on_receive() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('已驗收', '已入庫') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE purchase_orders po
       SET status_received = true, status = 'received', updated_at = now()
     WHERE po.po_number IN (SELECT DISTINCT po_number FROM consolidated_shipment_items WHERE shipment_id = NEW.id AND po_number IS NOT NULL)
       AND NOT po.status_received
       AND NOT po.status_cancelled
       -- 同一張採購單若還有別的集運批次沒點收，先不結案
       AND NOT EXISTS (
         SELECT 1 FROM consolidated_shipment_items csi2
           JOIN consolidated_shipments cs2 ON cs2.id = csi2.shipment_id
          WHERE csi2.po_number = po.po_number
            AND cs2.id <> NEW.id
            AND COALESCE(cs2.status, '') NOT IN ('已驗收', '已入庫'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consolidated_shipments_close_po ON consolidated_shipments;
CREATE TRIGGER trg_consolidated_shipments_close_po
  AFTER UPDATE OF status ON consolidated_shipments
  FOR EACH ROW EXECUTE FUNCTION trg_close_purchase_orders_on_receive();

-- B ───────────────────────────────────────────────
-- p: { "forwarder": text, "shipping_method": text, "departure_date": date, "expected_arrival": date,
--      "total_weight_kg": numeric|null, "total_cost_ntd": numeric|null, "notes": text,
--      "items": [{ "po_item_id": bigint, "qty": int }] }
CREATE OR REPLACE FUNCTION create_consolidated_shipment(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  today_tpe date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  prefix text := 'CU-' || to_char((now() AT TIME ZONE 'Asia/Taipei')::date, 'YYYYMMDD') || '-';
  seq int;
  sid bigint;
  num text;
  it jsonb;
  poi record;
  q int;
  n int := 0;
BEGIN
  IF jsonb_typeof(p -> 'items') <> 'array' OR jsonb_array_length(p -> 'items') = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS';
  END IF;

  -- 同一天兩人同時建批次時避免撞號
  PERFORM pg_advisory_xact_lock(hashtext('consolidated_shipment_number'));
  SELECT COALESCE(max(substring(shipment_number FROM length(prefix) + 1)::int), 0) + 1 INTO seq
    FROM consolidated_shipments WHERE shipment_number LIKE prefix || '%' AND substring(shipment_number FROM length(prefix) + 1) ~ '^\d+$';
  num := prefix || lpad(seq::text, 3, '0');

  INSERT INTO consolidated_shipments (shipment_number, forwarder, shipping_method, departure_date, expected_arrival,
                                      status, total_weight_kg, total_cost_ntd, notes)
  VALUES (num, NULLIF(p ->> 'forwarder', ''), NULLIF(p ->> 'shipping_method', ''),
          COALESCE(NULLIF(p ->> 'departure_date', '')::date, today_tpe), NULLIF(p ->> 'expected_arrival', '')::date,
          '準備中', NULLIF(p ->> 'total_weight_kg', '')::numeric, NULLIF(p ->> 'total_cost_ntd', '')::numeric,
          NULLIF(p ->> 'notes', ''))
  RETURNING id INTO sid;

  FOR it IN SELECT * FROM jsonb_array_elements(p -> 'items') LOOP
    q := (it ->> 'qty')::int;
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    SELECT poi2.*, po.po_number, po.status_cancelled, pr.weight_kg AS product_weight
      INTO poi
      FROM purchase_order_items poi2
      JOIN purchase_orders po ON po.id = poi2.po_id
      LEFT JOIN products pr ON pr.id = poi2.product_id
     WHERE poi2.id = (it ->> 'po_item_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'PO_ITEM_NOT_FOUND %', it ->> 'po_item_id'; END IF;
    IF poi.status_cancelled THEN RAISE EXCEPTION 'PO_CANCELLED %', poi.po_number; END IF;
    IF poi.product_id IS NULL THEN RAISE EXCEPTION 'ITEM_NOT_LINKED %', poi.product_name; END IF;

    -- weight_kg 存單件重量（點收分攤運費時以「單件重 ÷ 總重 × 總運費」計算每件運費）
    INSERT INTO consolidated_shipment_items (shipment_id, po_number, product_id, product_name, variant_name, qty, weight_kg)
    VALUES (sid, poi.po_number, poi.product_id, poi.product_name, poi.variant_name, q,
            COALESCE(poi.product_weight, CASE WHEN poi.qty > 0 THEN poi.weight_kg / poi.qty END));
    n := n + 1;

    UPDATE purchase_orders SET status_shipping = true,
           status = CASE WHEN status IN ('draft', 'confirmed', 'ordered', 'paid') THEN 'shipping'::po_status_enum ELSE status END,
           updated_at = now()
     WHERE po_number = poi.po_number;
  END LOOP;

  IF n = 0 THEN RAISE EXCEPTION 'NO_ITEMS'; END IF;
  RETURN jsonb_build_object('shipment_id', sid, 'shipment_number', num, 'items', n);
END;
$$;

-- C ───────────────────────────────────────────────
CREATE OR REPLACE VIEW v_reorder_suggestions WITH (security_invoker = true) AS
WITH last_day AS (
  -- 以「資料庫裡最新一張訂單的日期」往回算 60 天：訂單是批次匯入，資料停在哪天就以那天為準，
  -- 不然匯入延遲期間日均會被算成 0、補貨建議全部消失。畫面會標出資料截至哪天。
  SELECT COALESCE(max(order_date), (now() AT TIME ZONE 'Asia/Taipei')::date) AS d FROM sales_orders
), sold AS (
  SELECT soi.product_id, sum(soi.qty)::numeric AS qty_60d
    FROM sales_order_items soi
    JOIN sales_orders so ON so.id = soi.order_id
   WHERE so.order_date > (SELECT d FROM last_day) - 60
     AND COALESCE(so.status, '') <> '不成立'
     AND soi.product_id IS NOT NULL
   GROUP BY soi.product_id
), on_order AS (
  SELECT poi.product_id, sum(poi.qty)::numeric AS qty
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
   WHERE NOT COALESCE(po.status_received, false) AND NOT COALESCE(po.status_cancelled, false)
     AND poi.product_id IS NOT NULL
   GROUP BY poi.product_id
), base AS (
  SELECT p.id AS product_id, p.product_name, p.variant_name, p.product_image, p.product_status, p.category,
         COALESCE(s.stock_qty, 0)::int AS stock_qty,
         COALESCE(o.qty, 0)::int AS on_order_qty,
         COALESCE(sd.qty_60d, 0)::int AS sold_60d,
         round(COALESCE(sd.qty_60d, 0) / 60.0, 2) AS daily_sales,
         COALESCE(p.avg_shipping_days, 21)::int AS lead_days,
         p.safety_stock,
         (SELECT d FROM last_day) AS sales_data_until
    FROM products p
    LEFT JOIN v_stock_current s ON s.product_id = p.id
    LEFT JOIN on_order o ON o.product_id = p.id
    LEFT JOIN sold sd ON sd.product_id = p.id
   WHERE COALESCE(p.product_status, '') NOT IN ('停售', '測品')
)
SELECT b.*,
       CASE WHEN b.daily_sales > 0 THEN floor(b.stock_qty / b.daily_sales)::int END AS days_left,
       GREATEST(
         ceil(b.daily_sales * (b.lead_days + 30))::int - b.stock_qty - b.on_order_qty,
         COALESCE(b.safety_stock, 0) - b.stock_qty - b.on_order_qty,
         0) AS suggest_qty
  FROM base b;

-- D ───────────────────────────────────────────────
ALTER TABLE receiving_record_items ADD COLUMN IF NOT EXISTS photo_path text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('receiving-photos', 'receiving-photos', false)
ON CONFLICT (id) DO NOTHING;

-- 儲存區權限沿用資料表的白名單條件（從 products 的現行 policy 讀出來，repo 不再多抄一份帳號 id）
DO $$
DECLARE cond text;
BEGIN
  SELECT qual INTO cond FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'products' AND policyname = 'authenticated_whitelist';
  IF cond IS NULL THEN RAISE EXCEPTION 'whitelist policy not found'; END IF;
  EXECUTE 'DROP POLICY IF EXISTS receiving_photos_whitelist ON storage.objects';
  EXECUTE format(
    'CREATE POLICY receiving_photos_whitelist ON storage.objects FOR ALL TO authenticated USING (bucket_id = %L AND %s) WITH CHECK (bucket_id = %L AND %s)',
    'receiving-photos', cond, 'receiving-photos', cond);
END;
$$;

-- receive_shipment：與 012 相同，只多寫 photo_path
CREATE OR REPLACE FUNCTION receive_shipment(p_shipment_id bigint, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  ship consolidated_shipments%ROWTYPE;
  today_tpe date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  rv_id bigint;
  it jsonb;
  csi consolidated_shipment_items%ROWTYPE;
  qty int;
  price numeric;
  rate numeric;
  fallback_rate numeric;
  w numeric;
  landed numeric;
  n_items int := 0;
  n_stocked int := 0;
  n_unlinked int := 0;
  n_cost int := 0;
  n_cost_skipped int := 0;
  card_fee constant numeric := 1.5;
BEGIN
  SELECT * INTO ship FROM consolidated_shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_FOUND';
  END IF;
  IF ship.status IN ('已驗收', '已入庫')
     OR EXISTS (SELECT 1 FROM receiving_records WHERE shipment_number = ship.shipment_number) THEN
    RAISE EXCEPTION 'ALREADY_RECEIVED';
  END IF;
  IF ship.total_weight_kg IS NULL OR ship.total_weight_kg <= 0 THEN
    RAISE EXCEPTION 'MISSING_WEIGHT';
  END IF;
  IF ship.total_cost_ntd IS NULL THEN
    RAISE EXCEPTION 'MISSING_COST';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS';
  END IF;

  SELECT cny_rate INTO fallback_rate FROM purchase_orders
   WHERE cny_rate BETWEEN 3 AND 10 ORDER BY created_at DESC LIMIT 1;

  INSERT INTO receiving_records (receiving_number, shipment_number, receiving_date, receiver)
  VALUES ('RV-' || to_char(today_tpe, 'YYYYMMDD') || '-' || lpad(p_shipment_id::text, 4, '0'),
          ship.shipment_number, today_tpe, COALESCE(auth.jwt() ->> 'email', 'manual'))
  RETURNING id INTO rv_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO csi FROM consolidated_shipment_items
     WHERE id = (it ->> 'id')::bigint AND shipment_id = p_shipment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_IN_SHIPMENT %', it ->> 'id';
    END IF;
    qty := GREATEST(COALESCE((it ->> 'actual_qty')::int, 0), 0);
    n_items := n_items + 1;

    INSERT INTO receiving_record_items (receiving_id, product_id, product_name, variant_name,
                                        expected_qty, actual_qty, condition, notes, photo_path)
    VALUES (rv_id, csi.product_id, csi.product_name, csi.variant_name,
            COALESCE(csi.qty, 0), qty, COALESCE(it ->> 'condition', '良好'), NULLIF(it ->> 'notes', ''),
            NULLIF(it ->> 'photo_path', ''));

    IF csi.product_id IS NULL THEN
      n_unlinked := n_unlinked + 1;
      CONTINUE;
    END IF;
    IF qty > 0 THEN
      n_stocked := n_stocked + 1;
    ELSE
      CONTINUE;
    END IF;

    SELECT poi.unit_price_cny INTO price
      FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id
     WHERE po.po_number = csi.po_number AND poi.product_id = csi.product_id AND poi.unit_price_cny > 0
     ORDER BY poi.id DESC LIMIT 1;
    IF price IS NULL THEN
      SELECT purchase_price_cny INTO price FROM products WHERE id = csi.product_id;
    END IF;
    IF price IS NULL OR price <= 0 THEN
      n_cost_skipped := n_cost_skipped + 1;
      CONTINUE;
    END IF;

    SELECT cny_rate INTO rate FROM purchase_orders
     WHERE po_number = csi.po_number AND cny_rate BETWEEN 3 AND 10;
    rate := COALESCE(rate, fallback_rate, 4.6);

    SELECT COALESCE(csi.weight_kg, p.weight_kg, 0) INTO w FROM products p WHERE p.id = csi.product_id;
    landed := price * rate * (1 + card_fee / 100) + (w / ship.total_weight_kg) * ship.total_cost_ntd;

    UPDATE products
       SET unit_cost_ntd = round(landed, 2), latest_po_number = ship.shipment_number
     WHERE id = csi.product_id;
    n_cost := n_cost + 1;
  END LOOP;

  UPDATE consolidated_shipments SET status = '已驗收', updated_at = now() WHERE id = p_shipment_id;

  RETURN jsonb_build_object(
    'receiving_id', rv_id, 'items', n_items, 'stocked', n_stocked,
    'unlinked', n_unlinked, 'cost_updated', n_cost, 'cost_skipped', n_cost_skipped);
END;
$$;

GRANT EXECUTE ON FUNCTION update_purchase_order(bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_consolidated_shipment(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION receive_shipment(bigint, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION update_purchase_order(bigint, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION create_consolidated_shipment(jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION receive_shipment(bigint, jsonb) FROM anon, public;
GRANT SELECT ON v_reorder_suggestions TO authenticated;
REVOKE ALL ON v_reorder_suggestions FROM anon;

COMMIT;
