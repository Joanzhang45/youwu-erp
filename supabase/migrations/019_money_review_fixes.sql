-- 019：018 獨立審查修正（2026-11-06）
--
-- 1. 已排／已收件數：已點收批次算「實收」但最多算到當初排的件數。
--    超收（排 10 收 12）不會讓採購單修改被「少於已排」擋住。
-- 2. 點收紀錄找不到某個集運品項時：那批貨若是新制點收（有任何品項對得回來），沒對到的品項算收到 0 件；
--    只有整批都是舊資料才退回「排了幾件就算收到幾件」。
-- 3. receive_shipment：同一個品項送兩次直接拒絕；點收品項加唯一索引。
-- 4. 「已完成」只排除「已完成(鑑賞期內)…」這一種，其他「已完成…退貨退款」照樣算取消。
--    sales_orders.is_cancelled 是存起來的欄位，改規則後要用 UPDATE 讓既有資料重算。
-- 5. 運費：沒填重量的品項先用同批其他品項的平均單件重量暫代；整批都沒重量才按件數平均分。

BEGIN;

-- 4 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_cancelled_status(s text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT s IS NOT NULL
     AND s ~* '不成立|取消|退貨|退款|cancel|refund|return'
     AND s !~ '^已完成\(鑑賞期內\)';
$$;
-- 讓 is_cancelled 依新規則重算（狀態沒變，不會觸發取消回沖）
UPDATE sales_orders SET status = status;

-- 3 ───────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_rri_receiving_shipment_item
  ON receiving_record_items (receiving_id, shipment_item_id) WHERE shipment_item_id IS NOT NULL;

-- 1、2 ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION po_product_shipped_qty(p_po_number text, p_product_id bigint, p_received_only boolean)
RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(
           CASE WHEN cs.status IN ('已驗收', '已入庫') THEN
             LEAST(csi.qty, COALESCE(
               (SELECT sum(rri.actual_qty) FROM receiving_record_items rri WHERE rri.shipment_item_id = csi.id),
               CASE WHEN EXISTS (SELECT 1 FROM receiving_record_items rri2
                                   JOIN receiving_records rr ON rr.id = rri2.receiving_id
                                  WHERE rr.shipment_number = cs.shipment_number AND rri2.shipment_item_id IS NOT NULL)
                    THEN 0 ELSE csi.qty END))
           ELSE csi.qty END), 0)::int
    FROM consolidated_shipment_items csi
    JOIN consolidated_shipments cs ON cs.id = csi.shipment_id
   WHERE csi.po_number = p_po_number
     AND csi.product_id = p_product_id
     AND (NOT p_received_only OR cs.status IN ('已驗收', '已入庫'));
$$;

-- 3、5 ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION receive_shipment(p_shipment_id bigint, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
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
  avg_w numeric;
  freight_unit numeric;
  landed numeric;
  old_cost numeric;
  stock_before numeric;
  total_wq numeric := 0;
  q_with_w numeric := 0;
  total_q numeric := 0;
  n_no_weight int := 0;
  by_qty boolean;
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
  IF (SELECT count(*) FROM jsonb_array_elements(p_items)) <> (SELECT count(DISTINCT value ->> 'id') FROM jsonb_array_elements(p_items)) THEN
    RAISE EXCEPTION 'DUPLICATE_ITEM';
  END IF;

  -- 先算這批貨的分攤基準：實收件數 × 單件重量（含沒對到商品的品項，它們也佔運費）
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO csi FROM consolidated_shipment_items
     WHERE id = (it ->> 'id')::bigint AND shipment_id = p_shipment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_IN_SHIPMENT %', it ->> 'id';
    END IF;
    qty := GREATEST(COALESCE((it ->> 'actual_qty')::int, 0), 0);
    CONTINUE WHEN qty = 0;
    SELECT COALESCE(NULLIF(csi.weight_kg, 0), NULLIF(p.weight_kg, 0)) INTO w
      FROM (SELECT 1) one LEFT JOIN products p ON p.id = csi.product_id;
    total_q := total_q + qty;
    IF w IS NULL THEN
      n_no_weight := n_no_weight + 1;
    ELSE
      total_wq := total_wq + qty * w;
      q_with_w := q_with_w + qty;
    END IF;
  END LOOP;
  -- 沒重量的品項用同批平均單件重量暫代；整批都沒重量才按件數平均分
  by_qty := q_with_w = 0;
  IF NOT by_qty THEN
    avg_w := total_wq / q_with_w;
    total_wq := total_wq + (total_q - q_with_w) * avg_w;
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
    qty := GREATEST(COALESCE((it ->> 'actual_qty')::int, 0), 0);
    n_items := n_items + 1;

    IF csi.product_id IS NOT NULL THEN
      -- 鎖住商品，讀「點收前」的庫存與成本（下面的 INSERT 會觸發入庫）
      SELECT unit_cost_ntd INTO old_cost FROM products WHERE id = csi.product_id FOR UPDATE;
      SELECT COALESCE(sum(qty_delta), 0) INTO stock_before FROM inventory_ledger WHERE product_id = csi.product_id;
    END IF;

    INSERT INTO receiving_record_items (receiving_id, product_id, product_name, variant_name,
                                        expected_qty, actual_qty, condition, notes, photo_path, shipment_item_id)
    VALUES (rv_id, csi.product_id, csi.product_name, csi.variant_name,
            COALESCE(csi.qty, 0), qty, COALESCE(it ->> 'condition', '良好'), NULLIF(it ->> 'notes', ''),
            NULLIF(it ->> 'photo_path', ''), csi.id);

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

    IF by_qty THEN
      freight_unit := ship.total_cost_ntd / total_q;
    ELSE
      SELECT COALESCE(NULLIF(csi.weight_kg, 0), NULLIF(p.weight_kg, 0), avg_w) INTO w FROM products p WHERE p.id = csi.product_id;
      freight_unit := w * ship.total_cost_ntd / total_wq;
    END IF;
    landed := price * rate * (1 + card_fee / 100) + freight_unit;

    -- 加權平均：點收前還有庫存且有成本，才和舊成本平均
    IF stock_before > 0 AND old_cost IS NOT NULL AND old_cost > 0 THEN
      landed := (stock_before * old_cost + qty * landed) / (stock_before + qty);
    END IF;

    UPDATE products
       SET unit_cost_ntd = round(landed, 2), latest_po_number = ship.shipment_number
     WHERE id = csi.product_id;
    n_cost := n_cost + 1;
  END LOOP;

  UPDATE consolidated_shipments SET status = '已驗收', updated_at = now() WHERE id = p_shipment_id;

  RETURN jsonb_build_object(
    'receiving_id', rv_id, 'items', n_items, 'stocked', n_stocked,
    'unlinked', n_unlinked, 'cost_updated', n_cost, 'cost_skipped', n_cost_skipped,
    'freight_by_qty', by_qty, 'no_weight', n_no_weight);
END;
$$;

COMMIT;
