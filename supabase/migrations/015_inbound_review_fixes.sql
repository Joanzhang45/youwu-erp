-- 015：014 獨立審查修正（2026-11-06）
--
-- 1. 採購單自動結案改為「每個商品已點收的數量 ≥ 叫貨數量」才結案；分批寄時第一批點收完不再整張結案。
--    有品項沒對到商品（無法排集運）的單不會自動結案，改由畫面上的「貨都到齊了，結案」手動結案。
-- 2. 補貨的「已叫未到」改成「叫貨數量 − 已點收數量」，不再把已入庫的貨重複算成在途；
--    日均不先四捨五入再乘；排除季節款（與今天頁缺貨警示一致）。
-- 3. 修改採購單：數量不能改到比已排進集運的還少，已排集運的品項不能刪；匯率只有在有填時才檢查。
-- 4. 建立集運批次：鎖住採購單、已結案／已取消的單不能排，排的數量不能超過「叫貨 − 已排集運」。

BEGIN;

-- 共用：某採購單某商品「已排進集運」與「已點收」的數量
CREATE OR REPLACE FUNCTION po_product_shipped_qty(p_po_number text, p_product_id bigint, p_received_only boolean)
RETURNS int
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT COALESCE(sum(csi.qty), 0)::int
    FROM consolidated_shipment_items csi
    JOIN consolidated_shipments cs ON cs.id = csi.shipment_id
   WHERE csi.po_number = p_po_number
     AND csi.product_id = p_product_id
     AND (NOT p_received_only OR cs.status IN ('已驗收', '已入庫'));
$$;

-- 1 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_close_purchase_orders_on_receive() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('已驗收', '已入庫') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE purchase_orders po
       SET status_received = true, status = 'received', updated_at = now()
     WHERE po.po_number IN (SELECT DISTINCT po_number FROM consolidated_shipment_items WHERE shipment_id = NEW.id AND po_number IS NOT NULL)
       AND NOT COALESCE(po.status_received, false)
       AND NOT COALESCE(po.status_cancelled, false)
       -- 沒對到商品的品項無法追蹤到貨，不自動結案
       AND NOT EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.po_id = po.id AND poi.product_id IS NULL)
       -- 每個商品都已點收到叫貨數量
       AND NOT EXISTS (
         SELECT 1 FROM (
           SELECT poi.product_id, sum(poi.qty) AS ordered
             FROM purchase_order_items poi WHERE poi.po_id = po.id GROUP BY poi.product_id
         ) o
          WHERE po_product_shipped_qty(po.po_number, o.product_id, true) < o.ordered);
  END IF;
  RETURN NEW;
END;
$$;

-- 2 ───────────────────────────────────────────────
CREATE OR REPLACE VIEW v_reorder_suggestions WITH (security_invoker = true) AS
WITH last_day AS (
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
  -- 在途 = 叫貨數量 − 已點收數量（同採購單同商品），只算還沒結案、沒取消的單
  SELECT x.product_id, sum(GREATEST(x.ordered - po_product_shipped_qty(x.po_number, x.product_id, true), 0))::numeric AS qty
    FROM (
      SELECT po.po_number, poi.product_id, sum(poi.qty) AS ordered
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id
       WHERE NOT COALESCE(po.status_received, false) AND NOT COALESCE(po.status_cancelled, false)
         AND poi.product_id IS NOT NULL
       GROUP BY po.po_number, poi.product_id
    ) x
   GROUP BY x.product_id
), base AS (
  SELECT p.id AS product_id, p.product_name, p.variant_name, p.product_image, p.product_status, p.category,
         COALESCE(s.stock_qty, 0)::int AS stock_qty,
         COALESCE(o.qty, 0)::int AS on_order_qty,
         COALESCE(sd.qty_60d, 0)::int AS sold_60d,
         COALESCE(sd.qty_60d, 0) / 60.0 AS daily_sales_exact,
         COALESCE(p.avg_shipping_days, 21)::int AS lead_days,
         p.safety_stock,
         (SELECT d FROM last_day) AS sales_data_until
    FROM products p
    LEFT JOIN v_stock_current s ON s.product_id = p.id
    LEFT JOIN on_order o ON o.product_id = p.id
    LEFT JOIN sold sd ON sd.product_id = p.id
   WHERE COALESCE(p.product_status, '') NOT IN ('停售', '測品', '季節款')
)
SELECT b.product_id, b.product_name, b.variant_name, b.product_image, b.product_status, b.category,
       b.stock_qty, b.on_order_qty, b.sold_60d,
       round(b.daily_sales_exact, 2) AS daily_sales,
       b.lead_days, b.safety_stock, b.sales_data_until,
       CASE WHEN b.daily_sales_exact > 0 THEN floor(GREATEST(b.stock_qty, 0) / b.daily_sales_exact)::int END AS days_left,
       GREATEST(
         ceil(b.daily_sales_exact * (b.lead_days + 30))::int - b.stock_qty - b.on_order_qty,
         COALESCE(b.safety_stock, 0) - b.stock_qty - b.on_order_qty,
         0) AS suggest_qty
  FROM base b;

-- 3 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_purchase_order(p_po_id bigint, p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  po purchase_orders%ROWTYPE;
  it jsonb;
  poi purchase_order_items%ROWTYPE;
  q int;
  price numeric;
  sub numeric;
  rate numeric;
  shipped int;
  other_qty int;
BEGIN
  SELECT * INTO po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO_NOT_FOUND'; END IF;
  IF po.status_received OR po.status_cancelled THEN RAISE EXCEPTION 'PO_LOCKED'; END IF;

  IF NULLIF(p ->> 'cny_rate', '') IS NOT NULL THEN
    rate := (p ->> 'cny_rate')::numeric;
    IF rate < 3 OR rate > 10 THEN RAISE EXCEPTION 'BAD_RATE'; END IF;
  ELSE
    rate := po.cny_rate;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p -> 'items', '[]'::jsonb)) LOOP
    q := (it ->> 'qty')::int;
    price := (it ->> 'unit_price_cny')::numeric;
    IF q IS NULL OR q < 0 OR price IS NULL OR price < 0 THEN RAISE EXCEPTION 'BAD_ITEM %', it; END IF;
    SELECT * INTO poi FROM purchase_order_items WHERE id = (it ->> 'id')::bigint AND po_id = p_po_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_IN_PO %', it ->> 'id'; END IF;

    IF poi.product_id IS NOT NULL THEN
      shipped := po_product_shipped_qty(po.po_number, poi.product_id, false);
      SELECT COALESCE(sum(qty), 0) INTO other_qty FROM purchase_order_items
       WHERE po_id = p_po_id AND product_id = poi.product_id AND id <> poi.id;
      IF q + other_qty < shipped THEN
        RAISE EXCEPTION 'BELOW_SHIPPED %', poi.product_name;
      END IF;
    END IF;

    IF q = 0 THEN
      DELETE FROM purchase_order_items WHERE id = poi.id;
    ELSE
      UPDATE purchase_order_items SET qty = q, unit_price_cny = price, subtotal_cny = round(q * price, 4) WHERE id = poi.id;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM purchase_order_items WHERE po_id = p_po_id) THEN
    RAISE EXCEPTION 'NO_ITEMS_LEFT';
  END IF;

  SELECT round(COALESCE(sum(subtotal_cny), 0), 4) INTO sub FROM purchase_order_items WHERE po_id = p_po_id;

  UPDATE purchase_orders
     SET order_date = COALESCE(NULLIF(p ->> 'order_date', '')::date, order_date),
         cny_rate = rate,
         notes = CASE WHEN p ? 'notes' THEN NULLIF(p ->> 'notes', '') ELSE notes END,
         subtotal_cny = sub, total_payment_cny = sub, grand_total = sub,
         total_payment_ntd = CASE WHEN rate IS NULL THEN total_payment_ntd ELSE round(sub * rate, 2) END,
         updated_at = now()
   WHERE id = p_po_id;

  RETURN jsonb_build_object('subtotal_cny', sub);
END;
$$;

-- 4 ───────────────────────────────────────────────
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
  ordered int;
  shipped int;
  n int := 0;
BEGIN
  IF jsonb_typeof(p -> 'items') <> 'array' OR jsonb_array_length(p -> 'items') = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('consolidated_shipment_number'));
  SELECT COALESCE(max(substring(shipment_number FROM length(prefix) + 1)::int), 0) + 1 INTO seq
    FROM consolidated_shipments
   WHERE shipment_number LIKE prefix || '%' AND substring(shipment_number FROM length(prefix) + 1) ~ '^\d+$';
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
    SELECT poi2.*, po.po_number, po.id AS the_po_id, pr.weight_kg AS product_weight
      INTO poi
      FROM purchase_order_items poi2
      JOIN purchase_orders po ON po.id = poi2.po_id
      LEFT JOIN products pr ON pr.id = poi2.product_id
     WHERE poi2.id = (it ->> 'po_item_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'PO_ITEM_NOT_FOUND %', it ->> 'po_item_id'; END IF;
    IF poi.product_id IS NULL THEN RAISE EXCEPTION 'ITEM_NOT_LINKED %', poi.product_name; END IF;

    -- 鎖住採購單再檢查狀態，避免和取消／結案同時發生
    PERFORM 1 FROM purchase_orders
      WHERE id = poi.the_po_id AND NOT COALESCE(status_cancelled, false) AND NOT COALESCE(status_received, false)
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PO_CLOSED %', poi.po_number; END IF;

    -- 同一採購單同一商品：已排集運（含這一批前面已加的）+ 這次 ≤ 叫貨總數
    SELECT COALESCE(sum(qty), 0) INTO ordered FROM purchase_order_items
     WHERE po_id = poi.the_po_id AND product_id = poi.product_id;
    shipped := po_product_shipped_qty(poi.po_number, poi.product_id, false);
    IF shipped + q > ordered THEN
      RAISE EXCEPTION 'OVER_SHIPPED %', poi.product_name;
    END IF;

    INSERT INTO consolidated_shipment_items (shipment_id, po_number, product_id, product_name, variant_name, qty, weight_kg)
    VALUES (sid, poi.po_number, poi.product_id, poi.product_name, poi.variant_name, q,
            COALESCE(poi.product_weight, CASE WHEN poi.qty > 0 THEN poi.weight_kg / poi.qty END));
    n := n + 1;

    UPDATE purchase_orders SET status_shipping = true,
           status = CASE WHEN status IN ('draft', 'confirmed', 'ordered', 'paid') THEN 'shipping'::po_status_enum ELSE status END,
           updated_at = now()
     WHERE id = poi.the_po_id;
  END LOOP;

  IF n = 0 THEN RAISE EXCEPTION 'NO_ITEMS'; END IF;
  RETURN jsonb_build_object('shipment_id', sid, 'shipment_number', num, 'items', n);
END;
$$;

GRANT EXECUTE ON FUNCTION po_product_shipped_qty(text, bigint, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION po_product_shipped_qty(text, bigint, boolean) FROM anon, public;
GRANT SELECT ON v_reorder_suggestions TO authenticated;
REVOKE ALL ON v_reorder_suggestions FROM anon;

COMMIT;
