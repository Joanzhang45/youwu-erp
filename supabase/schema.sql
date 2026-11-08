-- 由 scripts/dump_schema.py 自動產生，請勿手改。改結構請寫 migration，套用後重跑本程式。
-- 從零重建：先跑 supabase/ci/platform_stub.sql（只在非 Supabase 的 Postgres 需要），再跑本檔。
SET check_function_bodies = off;
SET client_min_messages = warning;

CREATE TYPE public.movement_type_enum AS ENUM ('purchase_receive', 'sale_ship', 'manual_adjust', 'return_reversal');
CREATE TYPE public.po_status_enum AS ENUM ('draft', 'confirmed', 'ordered', 'paid', 'shipping', 'warehouse_received', 'warehouse_stored', 'return_shipping', 'received', 'cancelled', 'abnormal');

CREATE SEQUENCE public.ad_costs_id_seq;
CREATE SEQUENCE public.competitor_products_id_seq;
CREATE SEQUENCE public.consolidated_shipment_items_id_seq;
CREATE SEQUENCE public.consolidated_shipments_id_seq;
CREATE SEQUENCE public.domestic_logistics_id_seq;
CREATE SEQUENCE public.domestic_logistics_items_id_seq;
CREATE SEQUENCE public.inventory_ledger_id_seq;
CREATE SEQUENCE public.operating_expenses_id_seq;
CREATE SEQUENCE public.product_selections_id_seq;
CREATE SEQUENCE public.product_variants_id_seq;
CREATE SEQUENCE public.products_id_seq;
CREATE SEQUENCE public.purchase_order_items_id_seq;
CREATE SEQUENCE public.purchase_orders_id_seq;
CREATE SEQUENCE public.receiving_record_items_id_seq;
CREATE SEQUENCE public.receiving_records_id_seq;
CREATE SEQUENCE public.sales_order_items_id_seq;
CREATE SEQUENCE public.sales_orders_id_seq;
CREATE SEQUENCE public.stock_snapshots_id_seq;

CREATE OR REPLACE FUNCTION public.cancel_purchase_order(p_po_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  po purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO_NOT_FOUND'; END IF;
  IF po.status_cancelled THEN RETURN jsonb_build_object('already_cancelled', true); END IF;
  IF po.status_received THEN RAISE EXCEPTION 'PO_RECEIVED'; END IF;
  IF EXISTS (SELECT 1 FROM consolidated_shipment_items WHERE po_number = po.po_number) THEN
    RAISE EXCEPTION 'HAS_SHIPMENTS';
  END IF;
  UPDATE purchase_orders SET status_cancelled = true, status = 'cancelled', updated_at = now() WHERE id = p_po_id;
  RETURN jsonb_build_object('cancelled', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_consolidated_shipment(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.create_purchase_order(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  od date := COALESCE(NULLIF(p ->> 'order_date', '')::date, (now() AT TIME ZONE 'Asia/Taipei')::date);
  prefix text := 'PO-' || to_char(od, 'YYYYMMDD') || '-';
  rate numeric := NULLIF(p ->> 'cny_rate', '')::numeric;
  seq int;
  num text;
  pid bigint;
  it jsonb;
  pr products%ROWTYPE;
  q int;
  price numeric;
  sub numeric := 0;
  n int := 0;
BEGIN
  IF rate IS NULL OR rate < 3 OR rate > 10 THEN RAISE EXCEPTION 'BAD_RATE'; END IF;
  IF jsonb_typeof(p -> 'items') <> 'array' OR jsonb_array_length(p -> 'items') = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('purchase_order_number'));
  SELECT COALESCE(max(substring(po_number FROM length(prefix) + 1)::int), 0) + 1 INTO seq
    FROM purchase_orders
   WHERE po_number LIKE prefix || '%' AND substring(po_number FROM length(prefix) + 1) ~ '^\d+$';
  num := prefix || lpad(seq::text, 3, '0');

  INSERT INTO purchase_orders (po_number, purchaser, order_date, cny_rate, notes, status,
                               status_draft, status_confirmed, status_ordered, status_paid, status_shipping,
                               status_warehouse_received, status_warehouse_stored, status_return_shipping,
                               status_received, status_cancelled, status_abnormal)
  VALUES (num, COALESCE(NULLIF(trim(p ->> 'purchaser'), ''), '張瓊安'), od, rate, NULLIF(trim(p ->> 'notes'), ''), 'ordered',
          false, false, true, false, false, false, false, false, false, false, 0)
  RETURNING id INTO pid;

  FOR it IN SELECT * FROM jsonb_array_elements(p -> 'items') LOOP
    q := (it ->> 'qty')::int;
    price := (it ->> 'unit_price_cny')::numeric;
    IF q IS NULL OR q <= 0 OR price IS NULL OR price <= 0 THEN RAISE EXCEPTION 'BAD_ITEM %', it; END IF;
    SELECT * INTO pr FROM products WHERE id = (it ->> 'product_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND %', it ->> 'product_id'; END IF;
    INSERT INTO purchase_order_items (po_id, product_id, product_name, variant_name, product_image, qty, unit_price_cny, subtotal_cny)
    VALUES (pid, pr.id, pr.product_name, pr.variant_name, pr.product_image, q, price, round(q * price, 4));
    sub := sub + round(q * price, 4);
    n := n + 1;
  END LOOP;

  UPDATE purchase_orders
     SET subtotal_cny = sub, total_payment_cny = sub, grand_total = sub, total_payment_ntd = round(sub * rate, 2)
   WHERE id = pid;

  RETURN jsonb_build_object('id', pid, 'po_number', num, 'items', n);
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_cancelled_status(s text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT s IS NOT NULL
     AND s ~* '不成立|取消|退貨|退款|cancel|refund|return'
     AND s !~ '^已完成\(鑑賞期內\)';
$function$;

CREATE OR REPLACE FUNCTION public.item_net_on_product(p_item_id bigint, p_product_id bigint)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(sum(qty_delta), 0)::int FROM inventory_ledger
   WHERE product_id = p_product_id
     AND ((ref_type = 'sales_order_item' AND ref_no = p_item_id::text)
       OR (ref_type = 'sales_item_remap' AND ref_no LIKE p_item_id::text || ':%'));
$function$;

CREATE OR REPLACE FUNCTION public.ledger_item_adjust(p_item_id bigint, p_product_id bigint, p_delta integer, p_note text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  mt text := CASE WHEN p_delta < 0 THEN 'sale_ship' ELSE 'return_reversal' END;
  inserted int;
BEGIN
  IF p_delta = 0 THEN RETURN; END IF;
  INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, occurred_at, note)
  VALUES (p_product_id, mt::movement_type_enum, p_delta, 'sales_order_item', p_item_id::text, NOW(), p_note)
  ON CONFLICT (movement_type, ref_type, ref_no, product_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN
    INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, occurred_at, note)
    VALUES (p_product_id, 'manual_adjust', p_delta, 'sales_item_remap',
            p_item_id::text || ':' || (extract(epoch FROM clock_timestamp()) * 1000000)::bigint, NOW(), p_note);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.po_product_shipped_qty(p_po_number text, p_product_id bigint, p_received_only boolean)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.product_last_count_date(p_product_id bigint)
 RETURNS date
 LANGUAGE sql
 STABLE
AS $function$
  SELECT GREATEST(
    (SELECT max(snapshot_date) FROM stock_snapshots WHERE product_id = p_product_id),
    (SELECT max((occurred_at AT TIME ZONE 'Asia/Taipei')::date) FROM inventory_ledger
      WHERE product_id = p_product_id AND ref_type IN ('shopee_stocktake_sync', 'stocktake_adjust')));
$function$;

CREATE OR REPLACE FUNCTION public.receive_shipment(p_shipment_id bigint, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.sale_covered_by_stocktake(p_product_id bigint, p_order_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM sales_orders so
     WHERE so.id = p_order_id AND so.order_date IS NOT NULL
       AND so.order_date < product_last_count_date(p_product_id));
$function$;

CREATE OR REPLACE FUNCTION public.submit_stocktake(p_items jsonb, p_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  today_tpe date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  ref text := COALESCE(NULLIF(p_ref, ''), 'ST-' || (extract(epoch FROM clock_timestamp()) * 1000)::bigint);
  it jsonb;
  pid bigint;
  counted int;
  seen int;
  book int;
  diff int;
  n int := 0;
  n_diff int := 0;
  details jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS';
  END IF;

  -- 先上鎖再檢查：同一次盤點的兩個請求同時到時，第二個會等第一個寫完，再看到「已送出」
  PERFORM pg_advisory_xact_lock(hashtext('stocktake:' || ref));
  IF p_ref IS NOT NULL AND EXISTS (SELECT 1 FROM inventory_ledger WHERE ref_type = 'stocktake_adjust' AND ref_no = ref) THEN
    RETURN jsonb_build_object('already_submitted', true, 'ref_no', ref,
      'diff_count', (SELECT count(*) FROM inventory_ledger WHERE ref_type = 'stocktake_adjust' AND ref_no = ref));
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) ORDER BY (value ->> 'product_id')::bigint LOOP
    pid := (it ->> 'product_id')::bigint;
    counted := (it ->> 'counted_qty')::int;
    IF pid IS NULL OR counted IS NULL OR counted < 0 THEN
      RAISE EXCEPTION 'BAD_ITEM %', it;
    END IF;
    PERFORM 1 FROM products WHERE id = pid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND %', pid;
    END IF;
    SELECT COALESCE(sum(qty_delta), 0) INTO book FROM inventory_ledger WHERE product_id = pid;
    seen := COALESCE((it ->> 'expected_qty')::int, book);
    diff := counted - seen;

    INSERT INTO stock_snapshots (product_id, counted_qty, snapshot_date, note)
    VALUES (pid, counted, today_tpe,
            CASE WHEN diff = 0 THEN '盤點：與帳上一致'
                 ELSE format('盤點差異：帳上 %s → 實際 %s（%s%s）', seen, counted, CASE WHEN diff > 0 THEN '+' ELSE '' END, diff) END)
    ON CONFLICT (product_id, snapshot_date)
    DO UPDATE SET counted_qty = EXCLUDED.counted_qty, note = EXCLUDED.note, created_at = now();

    IF diff <> 0 THEN
      INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, note)
      VALUES (pid, 'manual_adjust', diff, 'stocktake_adjust', ref, '盤點修正');
      n_diff := n_diff + 1;
    END IF;
    n := n + 1;
    details := details || jsonb_build_object('product_id', pid, 'seen', seen, 'book_now', book, 'counted', counted, 'diff', diff);
  END LOOP;

  RETURN jsonb_build_object('count', n, 'diff_count', n_diff, 'ref_no', ref, 'items', details);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_close_purchase_orders_on_receive()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.trg_inventory_ledger_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.movement_type IS DISTINCT FROM OLD.movement_type
     OR NEW.qty_delta IS DISTINCT FROM OLD.qty_delta
     OR NEW.ref_type IS DISTINCT FROM OLD.ref_type
     OR NEW.ref_no IS DISTINCT FROM OLD.ref_no
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION '帳本不可修改，錯帳請新增反向沖銷列（manual_adjust）';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_inventory_ledger_no_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF coalesce(current_setting('youwu.allow_ledger_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'LEDGER_NO_DELETE 庫存紀錄不能刪除，記錯請新增反向沖銷列（manual_adjust）';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_receiving_item_to_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, occurred_at)
  VALUES (NEW.product_id, 'purchase_receive', COALESCE(NEW.actual_qty, 0), 'receiving_record_item', NEW.id::text, NOW())
  ON CONFLICT (movement_type, ref_type, ref_no, product_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sales_item_cost_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.unit_cost_at_sale IS NULL THEN
    SELECT unit_cost_ntd INTO NEW.unit_cost_at_sale FROM products WHERE id = NEW.product_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    -- 品項改對應到別的商品：成本跟著換成新商品的
    SELECT unit_cost_ntd INTO NEW.unit_cost_at_sale FROM products WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sales_item_remap_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  st text;
  old_net int := 0;
  new_net int;
BEGIN
  IF NEW.product_id IS NOT DISTINCT FROM OLD.product_id THEN
    RETURN NEW;
  END IF;
  SELECT status INTO st FROM sales_orders WHERE id = NEW.order_id;

  IF OLD.product_id IS NOT NULL THEN
    old_net := item_net_on_product(OLD.id, OLD.product_id);
    IF old_net = 0 THEN
      -- 原商品上沒有這筆的扣帳（004 前的歷史品項、已被盤點涵蓋、或已取消）：維持原狀，不在新商品上重扣
      RETURN NEW;
    END IF;
    PERFORM ledger_item_adjust(OLD.id, OLD.product_id, -old_net, '訂單品項改對應到別的商品，撤回原商品的出貨');
  END IF;

  IF NEW.product_id IS NOT NULL AND NOT is_cancelled_status(st)
     AND NOT sale_covered_by_stocktake(NEW.product_id, NEW.order_id) THEN
    new_net := item_net_on_product(NEW.id, NEW.product_id);
    PERFORM ledger_item_adjust(NEW.id, NEW.product_id, -COALESCE(NEW.qty, 0) - new_net, NULL);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sales_item_to_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.product_id IS NULL OR sale_covered_by_stocktake(NEW.product_id, NEW.order_id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, occurred_at)
  VALUES (NEW.product_id, 'sale_ship', -COALESCE(NEW.qty, 0), 'sales_order_item', NEW.id::text, NOW())
  ON CONFLICT (movement_type, ref_type, ref_no, product_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sales_order_cancel_reversal()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  r record;
  net int;
  shipped_at timestamptz;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND is_cancelled_status(NEW.status) THEN
    FOR r IN SELECT soi.id, soi.product_id FROM sales_order_items soi
              WHERE soi.order_id = NEW.id AND soi.product_id IS NOT NULL LOOP
      net := item_net_on_product(r.id, r.product_id);
      CONTINUE WHEN net >= 0;
      -- 不成立＝沒出貨：扣帳之後若做過盤點，盤點時貨還在架上、已經補回帳上，不再回沖
      IF NEW.status ~ '不成立' THEN
        SELECT max(occurred_at) INTO shipped_at FROM inventory_ledger
         WHERE movement_type = 'sale_ship' AND ref_type = 'sales_order_item' AND ref_no = r.id::text AND product_id = r.product_id;
        CONTINUE WHEN shipped_at IS NOT NULL
          AND (shipped_at AT TIME ZONE 'Asia/Taipei')::date < product_last_count_date(r.product_id);
      END IF;
      PERFORM ledger_item_adjust(r.id, r.product_id, -net,
        '訂單 ' || COALESCE(NEW.order_number, NEW.id::text) || ' 狀態轉為「' || NEW.status || '」自動回沖');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_purchase_order(p_po_id bigint, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE TABLE public.ad_costs (
  id bigint DEFAULT nextval('ad_costs_id_seq'::regclass) NOT NULL,
  ad_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.app_users (
  user_id uuid NOT NULL,
  display_name text NOT NULL
);
CREATE TABLE public.competitor_products (
  id bigint DEFAULT nextval('competitor_products_id_seq'::regclass) NOT NULL,
  selection_id bigint,
  competitor_name text,
  competitor_price numeric(10,2),
  competitor_link text,
  notes text
);
CREATE TABLE public.consolidated_shipment_items (
  id bigint DEFAULT nextval('consolidated_shipment_items_id_seq'::regclass) NOT NULL,
  shipment_id bigint,
  po_number text,
  product_id bigint,
  product_name text,
  variant_name text,
  qty integer,
  weight_kg numeric(8,4),
  notes text
);
CREATE TABLE public.consolidated_shipments (
  id bigint DEFAULT nextval('consolidated_shipments_id_seq'::regclass) NOT NULL,
  shipment_number text,
  forwarder text,
  shipping_method text,
  departure_date date,
  expected_arrival date,
  actual_arrival date,
  status text DEFAULT 'pending'::text,
  total_weight_kg numeric(10,4),
  shipping_cost_ntd numeric(12,2),
  customs_duty numeric(10,2),
  total_cost_ntd numeric(12,2),
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.domestic_logistics (
  id bigint DEFAULT nextval('domestic_logistics_id_seq'::regclass) NOT NULL,
  tracking_number text,
  po_number text,
  forwarder text,
  logistics_company text,
  waybill_number text,
  shipping_date date,
  expected_arrival date,
  actual_arrival date,
  status text DEFAULT 'pending'::text,
  total_weight_kg numeric(10,4),
  shipping_cost_cny numeric(10,4),
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.domestic_logistics_items (
  id bigint DEFAULT nextval('domestic_logistics_items_id_seq'::regclass) NOT NULL,
  logistics_id bigint,
  product_id bigint,
  product_name text,
  variant_name text,
  qty integer,
  weight_kg numeric(8,4),
  notes text
);
CREATE TABLE public.inventory_ledger (
  id bigint DEFAULT nextval('inventory_ledger_id_seq'::regclass) NOT NULL,
  product_id bigint NOT NULL,
  movement_type movement_type_enum NOT NULL,
  qty_delta integer NOT NULL,
  ref_type text,
  ref_no text,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid DEFAULT auth.uid()
);
CREATE TABLE public.operating_expenses (
  id bigint DEFAULT nextval('operating_expenses_id_seq'::regclass) NOT NULL,
  expense_date date,
  category text,
  description text,
  amount numeric(12,2),
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  item_name text,
  quantity integer
);
CREATE TABLE public.product_selections (
  id bigint DEFAULT nextval('product_selections_id_seq'::regclass) NOT NULL,
  selection_date date,
  selection_number text,
  product_name text NOT NULL,
  product_image text,
  cny_rate numeric(6,4) DEFAULT 4.57,
  category text,
  notes text,
  shipping_method text DEFAULT 'sea'::text,
  shipping_rate_per_kg numeric(8,2) DEFAULT 42,
  order_link text,
  status text DEFAULT 'evaluating'::text,
  sales_mode text DEFAULT 'stock'::text,
  domestic_shipping_cny numeric(10,4) DEFAULT 0,
  total_purchase_cost_ntd numeric(12,2),
  competitor_max_price numeric(10,2),
  competitor_min_price numeric(10,2),
  total_qty integer,
  total_weight_kg numeric(10,4),
  order_amount_cny numeric(12,4),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.product_variants (
  id bigint DEFAULT nextval('product_variants_id_seq'::regclass) NOT NULL,
  selection_id bigint,
  variant_name text,
  variant_image text,
  purchase_price_cny numeric(10,4),
  selling_price_ntd numeric(10,2),
  weight_kg numeric(8,4),
  domestic_shipping_cny numeric(8,4),
  qty integer DEFAULT 0,
  unit_cost_ntd numeric(10,4),
  profit_ntd numeric(10,4),
  margin_pct numeric(6,2),
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.products (
  id bigint DEFAULT nextval('products_id_seq'::regclass) NOT NULL,
  product_name text NOT NULL,
  sku text,
  category text,
  variant_name text,
  selection_number text,
  shopee_spec_id text,
  order_link text,
  product_positioning text,
  product_image text,
  notes text,
  selling_price numeric(10,2),
  purchase_price_cny numeric(10,4),
  product_status text DEFAULT 'testing'::text,
  domestic_shipping_thrown numeric(10,4),
  unit_cost_ntd numeric(10,4),
  domestic_shipping_per_unit_cny numeric(10,4),
  initial_order_qty integer,
  domestic_shipping_per_unit_thrown numeric(10,4),
  platform_fee_rate numeric(10,6) DEFAULT 12.9,
  avg_daily_sales numeric(8,4),
  avg_shipping_days numeric(8,2),
  unit_profit numeric(10,4),
  weight_kg numeric(8,4),
  safety_stock integer,
  total_purchased_qty integer DEFAULT 0,
  total_purchase_cost numeric(12,2) DEFAULT 0,
  avg_purchase_price numeric(10,4),
  current_stock_cost numeric(12,2) DEFAULT 0,
  total_sold_qty integer DEFAULT 0,
  total_sales_revenue numeric(12,2) DEFAULT 0,
  gross_margin numeric(10,6),
  realized_profit numeric(12,2) DEFAULT 0,
  total_shipped_qty integer DEFAULT 0,
  shopee_fee_total numeric(12,2) DEFAULT 0,
  net_revenue_subtotal numeric(12,2) DEFAULT 0,
  first_order_date date,
  total_order_days integer,
  latest_po_number text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.purchase_order_items (
  id bigint DEFAULT nextval('purchase_order_items_id_seq'::regclass) NOT NULL,
  po_id bigint,
  product_id bigint,
  product_name text,
  variant_name text,
  product_image text,
  qty integer NOT NULL,
  unit_price_cny numeric(10,4),
  subtotal_cny numeric(12,4),
  weight_kg numeric(8,4),
  domestic_shipping_cny numeric(10,4),
  notes text,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.purchase_orders (
  id bigint DEFAULT nextval('purchase_orders_id_seq'::regclass) NOT NULL,
  po_number text NOT NULL,
  purchaser text,
  payment_method text,
  forwarder text,
  forwarder_phone text,
  order_date date,
  photo_thumbnail text,
  cny_rate numeric(6,4),
  shipping_rate_per_kg numeric(8,2),
  logistics_status text DEFAULT 'draft'::text,
  total_payment_cny numeric(12,4),
  forwarder_address text,
  notes text,
  total_payment_ntd numeric(12,2),
  payment_status text DEFAULT 'unpaid'::text,
  subtotal_cny numeric(12,4),
  customs_duty numeric(10,2),
  grand_total numeric(12,2),
  status_draft boolean DEFAULT false,
  status_confirmed boolean DEFAULT false,
  status_ordered boolean DEFAULT false,
  status_paid boolean DEFAULT false,
  status_shipping boolean DEFAULT false,
  status_warehouse_received boolean DEFAULT false,
  status_warehouse_stored boolean DEFAULT false,
  status_return_shipping boolean DEFAULT false,
  status_received boolean DEFAULT false,
  status_cancelled boolean DEFAULT false,
  status_abnormal integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  status po_status_enum DEFAULT 'draft'::po_status_enum NOT NULL
);
CREATE TABLE public.receiving_record_items (
  id bigint DEFAULT nextval('receiving_record_items_id_seq'::regclass) NOT NULL,
  receiving_id bigint,
  product_id bigint,
  product_name text,
  variant_name text,
  expected_qty integer,
  actual_qty integer,
  discrepancy integer GENERATED ALWAYS AS ((actual_qty - expected_qty)) STORED,
  condition text DEFAULT 'good'::text,
  notes text,
  photo_path text,
  shipment_item_id bigint
);
CREATE TABLE public.receiving_records (
  id bigint DEFAULT nextval('receiving_records_id_seq'::regclass) NOT NULL,
  receiving_number text,
  shipment_number text,
  receiving_date date,
  receiver text,
  notes text,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.sales_order_items (
  id bigint DEFAULT nextval('sales_order_items_id_seq'::regclass) NOT NULL,
  order_id bigint,
  product_id bigint,
  product_name text,
  variant_name text,
  qty integer,
  unit_price numeric(10,2),
  subtotal numeric(12,2),
  unit_cost_at_sale numeric(12,4)
);
CREATE TABLE public.sales_orders (
  id bigint DEFAULT nextval('sales_orders_id_seq'::regclass) NOT NULL,
  order_number text,
  order_date date,
  buyer_name text,
  order_amount numeric(12,2),
  transaction_fee numeric(10,2),
  free_shipping_subsidy numeric(10,2),
  extended_prep_fee numeric(10,2),
  payment_processing_fee numeric(10,2),
  seller_coupon numeric(10,2),
  platform_coupon numeric(10,2),
  net_revenue numeric(12,2),
  status text DEFAULT 'pending'::text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  is_cancelled boolean GENERATED ALWAYS AS (is_cancelled_status(status)) STORED
);
CREATE TABLE public.stock_snapshots (
  id bigint DEFAULT nextval('stock_snapshots_id_seq'::regclass) NOT NULL,
  product_id bigint NOT NULL,
  counted_qty integer NOT NULL,
  snapshot_date date NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE public.ad_costs_id_seq OWNED BY public.ad_costs.id;
ALTER SEQUENCE public.competitor_products_id_seq OWNED BY public.competitor_products.id;
ALTER SEQUENCE public.consolidated_shipment_items_id_seq OWNED BY public.consolidated_shipment_items.id;
ALTER SEQUENCE public.consolidated_shipments_id_seq OWNED BY public.consolidated_shipments.id;
ALTER SEQUENCE public.domestic_logistics_id_seq OWNED BY public.domestic_logistics.id;
ALTER SEQUENCE public.domestic_logistics_items_id_seq OWNED BY public.domestic_logistics_items.id;
ALTER SEQUENCE public.inventory_ledger_id_seq OWNED BY public.inventory_ledger.id;
ALTER SEQUENCE public.operating_expenses_id_seq OWNED BY public.operating_expenses.id;
ALTER SEQUENCE public.product_selections_id_seq OWNED BY public.product_selections.id;
ALTER SEQUENCE public.product_variants_id_seq OWNED BY public.product_variants.id;
ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;
ALTER SEQUENCE public.purchase_order_items_id_seq OWNED BY public.purchase_order_items.id;
ALTER SEQUENCE public.purchase_orders_id_seq OWNED BY public.purchase_orders.id;
ALTER SEQUENCE public.receiving_record_items_id_seq OWNED BY public.receiving_record_items.id;
ALTER SEQUENCE public.receiving_records_id_seq OWNED BY public.receiving_records.id;
ALTER SEQUENCE public.sales_order_items_id_seq OWNED BY public.sales_order_items.id;
ALTER SEQUENCE public.sales_orders_id_seq OWNED BY public.sales_orders.id;
ALTER SEQUENCE public.stock_snapshots_id_seq OWNED BY public.stock_snapshots.id;

ALTER TABLE ad_costs ADD CONSTRAINT ad_costs_pkey PRIMARY KEY (id);
ALTER TABLE app_users ADD CONSTRAINT app_users_pkey PRIMARY KEY (user_id);
ALTER TABLE competitor_products ADD CONSTRAINT competitor_products_pkey PRIMARY KEY (id);
ALTER TABLE consolidated_shipment_items ADD CONSTRAINT consolidated_shipment_items_pkey PRIMARY KEY (id);
ALTER TABLE consolidated_shipments ADD CONSTRAINT consolidated_shipments_shipment_number_key UNIQUE (shipment_number);
ALTER TABLE consolidated_shipments ADD CONSTRAINT consolidated_shipments_pkey PRIMARY KEY (id);
ALTER TABLE domestic_logistics ADD CONSTRAINT domestic_logistics_pkey PRIMARY KEY (id);
ALTER TABLE domestic_logistics_items ADD CONSTRAINT domestic_logistics_items_pkey PRIMARY KEY (id);
ALTER TABLE inventory_ledger ADD CONSTRAINT uq_inventory_ledger_dedup UNIQUE (movement_type, ref_type, ref_no, product_id);
ALTER TABLE inventory_ledger ADD CONSTRAINT inventory_ledger_pkey PRIMARY KEY (id);
ALTER TABLE operating_expenses ADD CONSTRAINT operating_expenses_pkey PRIMARY KEY (id);
ALTER TABLE product_selections ADD CONSTRAINT product_selections_selection_number_key UNIQUE (selection_number);
ALTER TABLE product_selections ADD CONSTRAINT product_selections_pkey PRIMARY KEY (id);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);
ALTER TABLE products ADD CONSTRAINT products_sku_key UNIQUE (sku);
ALTER TABLE products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE products ADD CONSTRAINT products_platform_fee_rate_pct CHECK (((platform_fee_rate IS NULL) OR ((platform_fee_rate >= (1)::numeric) AND (platform_fee_rate <= (100)::numeric))));
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id);
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_po_number_key UNIQUE (po_number);
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);
ALTER TABLE receiving_record_items ADD CONSTRAINT receiving_record_items_pkey PRIMARY KEY (id);
ALTER TABLE receiving_records ADD CONSTRAINT receiving_records_receiving_number_key UNIQUE (receiving_number);
ALTER TABLE receiving_records ADD CONSTRAINT receiving_records_pkey PRIMARY KEY (id);
ALTER TABLE sales_order_items ADD CONSTRAINT sales_order_items_pkey PRIMARY KEY (id);
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_order_number_key UNIQUE (order_number);
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_pkey PRIMARY KEY (id);
ALTER TABLE stock_snapshots ADD CONSTRAINT uq_stock_snapshots_product_date UNIQUE (product_id, snapshot_date);
ALTER TABLE stock_snapshots ADD CONSTRAINT stock_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE competitor_products ADD CONSTRAINT competitor_products_selection_id_fkey FOREIGN KEY (selection_id) REFERENCES product_selections(id) ON DELETE CASCADE;
ALTER TABLE consolidated_shipment_items ADD CONSTRAINT consolidated_shipment_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE consolidated_shipment_items ADD CONSTRAINT consolidated_shipment_items_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES consolidated_shipments(id) ON DELETE CASCADE;
ALTER TABLE domestic_logistics_items ADD CONSTRAINT domestic_logistics_items_logistics_id_fkey FOREIGN KEY (logistics_id) REFERENCES domestic_logistics(id) ON DELETE CASCADE;
ALTER TABLE domestic_logistics_items ADD CONSTRAINT domestic_logistics_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE inventory_ledger ADD CONSTRAINT inventory_ledger_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_selection_id_fkey FOREIGN KEY (selection_id) REFERENCES product_selections(id) ON DELETE CASCADE;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE receiving_record_items ADD CONSTRAINT receiving_record_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE receiving_record_items ADD CONSTRAINT receiving_record_items_receiving_id_fkey FOREIGN KEY (receiving_id) REFERENCES receiving_records(id) ON DELETE CASCADE;
ALTER TABLE receiving_record_items ADD CONSTRAINT receiving_record_items_shipment_item_id_fkey FOREIGN KEY (shipment_item_id) REFERENCES consolidated_shipment_items(id);
ALTER TABLE sales_order_items ADD CONSTRAINT sales_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE;
ALTER TABLE sales_order_items ADD CONSTRAINT sales_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE stock_snapshots ADD CONSTRAINT stock_snapshots_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);

CREATE INDEX idx_ad_costs_date ON public.ad_costs USING btree (ad_date);
CREATE INDEX idx_inventory_ledger_occurred ON public.inventory_ledger USING btree (occurred_at);
CREATE INDEX idx_inventory_ledger_product ON public.inventory_ledger USING btree (product_id);
CREATE INDEX idx_po_date ON public.purchase_orders USING btree (order_date);
CREATE INDEX idx_po_number ON public.purchase_orders USING btree (po_number);
CREATE INDEX idx_products_name ON public.products USING btree (product_name);
CREATE INDEX idx_products_sku ON public.products USING btree (sku);
CREATE INDEX idx_products_status ON public.products USING btree (product_status);
CREATE INDEX idx_rri_shipment_item ON public.receiving_record_items USING btree (shipment_item_id);
CREATE INDEX idx_sales_orders_date ON public.sales_orders USING btree (order_date);
CREATE INDEX idx_sales_orders_is_cancelled ON public.sales_orders USING btree (is_cancelled);
CREATE UNIQUE INDEX uq_ad_costs_date_amount_desc ON public.ad_costs USING btree (ad_date, amount, COALESCE(description, ''::text));
CREATE UNIQUE INDEX uq_receiving_records_shipment ON public.receiving_records USING btree (shipment_number) WHERE (shipment_number IS NOT NULL);
CREATE UNIQUE INDEX uq_rri_receiving_shipment_item ON public.receiving_record_items USING btree (receiving_id, shipment_item_id) WHERE (shipment_item_id IS NOT NULL);

CREATE VIEW public.v_stock_current WITH (security_invoker=true) AS
 SELECT product_id,
    sum(qty_delta) AS stock_qty
   FROM inventory_ledger
  GROUP BY product_id;

CREATE VIEW public.v_dashboard_kpi WITH (security_invoker=true) AS
 WITH cogs AS (
         SELECT COALESCE(sum(soi.qty::numeric * COALESCE(soi.unit_cost_at_sale, p.unit_cost_ntd)), 0::numeric) AS v
           FROM sales_order_items soi
             JOIN products p ON p.id = soi.product_id
             JOIN sales_orders so2 ON so2.id = soi.order_id
          WHERE NOT so2.is_cancelled
        ), ad AS (
         SELECT COALESCE(sum(ad_costs.amount), 0::numeric) AS v
           FROM ad_costs
        ), ex AS (
         SELECT COALESCE(sum(operating_expenses.amount), 0::numeric) AS v
           FROM operating_expenses
        )
 SELECT count(DISTINCT id) AS order_count,
    COALESCE(sum(order_amount), 0::numeric) AS total_revenue,
    COALESCE(sum(net_revenue), 0::numeric) AS total_net_revenue,
    ( SELECT cogs.v
           FROM cogs) AS total_cogs,
    ( SELECT ad.v
           FROM ad) AS total_ad_cost,
    ( SELECT ex.v
           FROM ex) AS total_expenses,
    COALESCE(sum(net_revenue), 0::numeric) - (( SELECT cogs.v
           FROM cogs)) AS gross_profit,
    COALESCE(sum(net_revenue), 0::numeric) - (( SELECT cogs.v
           FROM cogs)) - (( SELECT ad.v
           FROM ad)) - (( SELECT ex.v
           FROM ex)) AS net_profit,
    ( SELECT count(*) AS count
           FROM products p
             LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id
          WHERE COALESCE(vsc.stock_qty, 0::bigint) <= 0) AS out_of_stock_count,
    ( SELECT count(*) AS count
           FROM products p
             LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id
          WHERE p.safety_stock IS NOT NULL AND COALESCE(vsc.stock_qty, 0::bigint) > 0 AND COALESCE(vsc.stock_qty, 0::bigint) <= p.safety_stock) AS low_stock_count
   FROM sales_orders so
  WHERE NOT is_cancelled;

CREATE VIEW public.v_monthly_profitability WITH (security_invoker=true) AS
 WITH order_months AS (
         SELECT date_trunc('month'::text, so.order_date::timestamp with time zone)::date AS month,
            count(*) AS order_count,
            COALESCE(sum(so.order_amount), 0::numeric) AS total_revenue,
            COALESCE(sum(so.net_revenue), 0::numeric) AS total_net_revenue
           FROM sales_orders so
          WHERE so.order_date IS NOT NULL AND NOT so.is_cancelled
          GROUP BY (date_trunc('month'::text, so.order_date::timestamp with time zone)::date)
        ), cogs_months AS (
         SELECT date_trunc('month'::text, so.order_date::timestamp with time zone)::date AS month,
            COALESCE(sum(soi.qty::numeric * COALESCE(soi.unit_cost_at_sale, p.unit_cost_ntd)), 0::numeric) AS total_cogs
           FROM sales_order_items soi
             JOIN sales_orders so ON so.id = soi.order_id
             JOIN products p ON p.id = soi.product_id
          WHERE so.order_date IS NOT NULL AND NOT so.is_cancelled
          GROUP BY (date_trunc('month'::text, so.order_date::timestamp with time zone)::date)
        ), ad_months AS (
         SELECT date_trunc('month'::text, ac.ad_date::timestamp with time zone)::date AS month,
            COALESCE(sum(ac.amount), 0::numeric) AS total_ad_cost
           FROM ad_costs ac
          WHERE ac.ad_date IS NOT NULL
          GROUP BY (date_trunc('month'::text, ac.ad_date::timestamp with time zone)::date)
        ), expense_months AS (
         SELECT date_trunc('month'::text, oe.expense_date::timestamp with time zone)::date AS month,
            COALESCE(sum(oe.amount), 0::numeric) AS total_expenses
           FROM operating_expenses oe
          WHERE oe.expense_date IS NOT NULL
          GROUP BY (date_trunc('month'::text, oe.expense_date::timestamp with time zone)::date)
        ), all_months AS (
         SELECT order_months.month
           FROM order_months
        UNION
         SELECT ad_months.month
           FROM ad_months
        UNION
         SELECT expense_months.month
           FROM expense_months
        )
 SELECT am.month,
    COALESCE(om.order_count, 0::bigint) AS order_count,
    COALESCE(om.total_revenue, 0::numeric) AS total_revenue,
    COALESCE(om.total_net_revenue, 0::numeric) AS total_net_revenue,
    COALESCE(cm.total_cogs, 0::numeric) AS total_cogs,
    COALESCE(om.total_net_revenue, 0::numeric) - COALESCE(cm.total_cogs, 0::numeric) AS gross_profit,
    COALESCE(adm.total_ad_cost, 0::numeric) AS total_ad_cost,
    COALESCE(exm.total_expenses, 0::numeric) AS total_expenses,
    COALESCE(om.total_net_revenue, 0::numeric) - COALESCE(cm.total_cogs, 0::numeric) - COALESCE(adm.total_ad_cost, 0::numeric) - COALESCE(exm.total_expenses, 0::numeric) AS net_profit
   FROM all_months am
     LEFT JOIN order_months om ON om.month = am.month
     LEFT JOIN cogs_months cm ON cm.month = am.month
     LEFT JOIN ad_months adm ON adm.month = am.month
     LEFT JOIN expense_months exm ON exm.month = am.month
  ORDER BY am.month DESC;

CREATE VIEW public.v_monthly_revenue WITH (security_invoker=true) AS
 SELECT to_char(order_date::timestamp with time zone, 'YYYY-MM'::text) AS month,
    count(*) AS order_count,
    sum(order_amount) AS total_revenue,
    sum(net_revenue) AS net_revenue,
    avg(order_amount) AS avg_order_value
   FROM sales_orders so
  WHERE order_date IS NOT NULL AND NOT is_cancelled
  GROUP BY (to_char(order_date::timestamp with time zone, 'YYYY-MM'::text))
  ORDER BY (to_char(order_date::timestamp with time zone, 'YYYY-MM'::text)) DESC;

CREATE VIEW public.v_product_sold WITH (security_invoker=true) AS
 SELECT soi.product_id,
    sum(soi.qty)::integer AS sold_qty,
    sum(soi.subtotal) AS sold_revenue
   FROM sales_order_items soi
     JOIN sales_orders so ON so.id = soi.order_id
  WHERE soi.product_id IS NOT NULL AND NOT so.is_cancelled
  GROUP BY soi.product_id;

CREATE VIEW public.v_product_profitability WITH (security_invoker=true) AS
 SELECT p.id,
    p.product_name,
    p.variant_name,
    p.sku,
    p.category,
    p.selling_price,
    p.unit_cost_ntd,
    p.platform_fee_rate,
    COALESCE(vsc.stock_qty, 0::bigint)::integer AS stock_qty,
    COALESCE(ps.sold_qty, 0) AS total_sold_qty,
    COALESCE(ps.sold_revenue, 0::numeric)::numeric(12,2) AS total_sales_revenue,
    p.product_status,
    p.product_positioning,
    COALESCE(p.selling_price * p.platform_fee_rate / 100::numeric, 0::numeric) AS platform_fees,
        CASE
            WHEN p.selling_price > 0::numeric THEN p.selling_price - COALESCE(p.unit_cost_ntd, 0::numeric) - p.selling_price * COALESCE(p.platform_fee_rate, 0::numeric) / 100::numeric
            ELSE 0::numeric
        END AS unit_profit,
        CASE
            WHEN p.selling_price > 0::numeric THEN (p.selling_price - COALESCE(p.unit_cost_ntd, 0::numeric) - p.selling_price * COALESCE(p.platform_fee_rate, 0::numeric) / 100::numeric) / p.selling_price
            ELSE 0::numeric
        END AS margin,
        CASE
            WHEN p.selling_price > 0::numeric THEN (p.selling_price - COALESCE(p.unit_cost_ntd, 0::numeric) - p.selling_price * COALESCE(p.platform_fee_rate, 0::numeric) / 100::numeric) * COALESCE(ps.sold_qty, 0)::numeric
            ELSE 0::numeric
        END AS total_profit
   FROM products p
     LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id
     LEFT JOIN v_product_sold ps ON ps.product_id = p.id
  WHERE p.selling_price IS NOT NULL AND p.selling_price > 0::numeric;

CREATE VIEW public.v_product_sales WITH (security_invoker=true) AS
 SELECT soi.product_id,
    p.product_name,
    p.variant_name,
    count(*) AS order_item_count,
    sum(soi.qty) AS total_qty,
    sum(soi.subtotal) AS total_revenue,
    avg(soi.unit_price) AS avg_unit_price
   FROM sales_order_items soi
     JOIN sales_orders so ON so.id = soi.order_id
     LEFT JOIN products p ON p.id = soi.product_id
  WHERE soi.product_id IS NOT NULL AND NOT so.is_cancelled
  GROUP BY soi.product_id, p.product_name, p.variant_name;

CREATE VIEW public.v_products_with_stock WITH (security_invoker=true) AS
 SELECT p.id,
    p.product_name,
    p.sku,
    p.category,
    p.variant_name,
    p.selection_number,
    p.shopee_spec_id,
    p.order_link,
    p.product_positioning,
    p.product_image,
    p.notes,
    p.selling_price,
    p.purchase_price_cny,
    p.product_status,
    p.domestic_shipping_thrown,
    p.unit_cost_ntd,
    p.domestic_shipping_per_unit_cny,
    p.initial_order_qty,
    p.domestic_shipping_per_unit_thrown,
    p.platform_fee_rate,
    p.avg_daily_sales,
    p.avg_shipping_days,
    p.unit_profit,
    p.weight_kg,
    p.safety_stock,
    p.total_purchased_qty,
    p.total_purchase_cost,
    p.avg_purchase_price,
    p.current_stock_cost,
    COALESCE(ps.sold_qty, 0) AS total_sold_qty,
    p.total_sales_revenue,
        CASE
            WHEN p.selling_price > 0::numeric AND p.unit_cost_ntd IS NOT NULL THEN round((p.selling_price - p.unit_cost_ntd - p.selling_price * COALESCE(p.platform_fee_rate, 0::numeric) / 100::numeric) / p.selling_price, 4)
            ELSE NULL::numeric
        END::numeric(10,6) AS gross_margin,
    p.realized_profit,
    p.total_shipped_qty,
    p.shopee_fee_total,
    p.net_revenue_subtotal,
    p.first_order_date,
    p.total_order_days,
    p.latest_po_number,
    p.created_at,
    p.updated_at,
    COALESCE(vsc.stock_qty, 0::bigint)::integer AS stock_qty
   FROM products p
     LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id
     LEFT JOIN v_product_sold ps ON ps.product_id = p.id;

CREATE VIEW public.v_reorder_suggestions WITH (security_invoker=true) AS
 WITH last_day AS (
         SELECT COALESCE(max(sales_orders.order_date), (now() AT TIME ZONE 'Asia/Taipei'::text)::date) AS d
           FROM sales_orders
        ), sold AS (
         SELECT soi.product_id,
            sum(soi.qty)::numeric AS qty_60d
           FROM sales_order_items soi
             JOIN sales_orders so ON so.id = soi.order_id
          WHERE so.order_date > ((( SELECT last_day.d
                   FROM last_day)) - 60) AND NOT so.is_cancelled AND soi.product_id IS NOT NULL
          GROUP BY soi.product_id
        ), on_order AS (
         SELECT x.product_id,
            sum(GREATEST(x.ordered - po_product_shipped_qty(x.po_number, x.product_id, true), 0::bigint)) AS qty
           FROM ( SELECT po.po_number,
                    poi.product_id,
                    sum(poi.qty) AS ordered
                   FROM purchase_order_items poi
                     JOIN purchase_orders po ON po.id = poi.po_id
                  WHERE NOT COALESCE(po.status_received, false) AND NOT COALESCE(po.status_cancelled, false) AND poi.product_id IS NOT NULL
                  GROUP BY po.po_number, poi.product_id) x
          GROUP BY x.product_id
        ), base AS (
         SELECT p.id AS product_id,
            p.product_name,
            p.variant_name,
            p.product_image,
            p.product_status,
            p.category,
            COALESCE(s.stock_qty, 0::bigint)::integer AS stock_qty,
            COALESCE(o.qty, 0::numeric)::integer AS on_order_qty,
            COALESCE(sd.qty_60d, 0::numeric)::integer AS sold_60d,
            COALESCE(sd.qty_60d, 0::numeric) / 60.0 AS daily_sales_exact,
            COALESCE(p.avg_shipping_days, 21::numeric)::integer AS lead_days,
            p.safety_stock,
            ( SELECT last_day.d
                   FROM last_day) AS sales_data_until
           FROM products p
             LEFT JOIN v_stock_current s ON s.product_id = p.id
             LEFT JOIN on_order o ON o.product_id = p.id
             LEFT JOIN sold sd ON sd.product_id = p.id
          WHERE COALESCE(p.product_status, ''::text) <> ALL (ARRAY['停售'::text, '測品'::text, '季節款'::text])
        )
 SELECT product_id,
    product_name,
    variant_name,
    product_image,
    product_status,
    category,
    stock_qty,
    on_order_qty,
    sold_60d,
    round(daily_sales_exact, 2) AS daily_sales,
    lead_days,
    safety_stock,
    sales_data_until,
        CASE
            WHEN daily_sales_exact > 0::numeric THEN floor(GREATEST(stock_qty, 0)::numeric / daily_sales_exact)::integer
            ELSE NULL::integer
        END AS days_left,
    GREATEST(ceil(daily_sales_exact * (lead_days + 30)::numeric)::integer - stock_qty - on_order_qty, COALESCE(safety_stock, 0) - stock_qty - on_order_qty, 0) AS suggest_qty
   FROM base b;

CREATE VIEW public.v_stock_reconciliation WITH (security_invoker=true) AS
 WITH latest_snapshot AS (
         SELECT DISTINCT ON (stock_snapshots.product_id) stock_snapshots.product_id,
            stock_snapshots.counted_qty,
            stock_snapshots.snapshot_date,
            stock_snapshots.note
           FROM stock_snapshots
          ORDER BY stock_snapshots.product_id, stock_snapshots.snapshot_date DESC
        ), ledger_qty_as_of AS (
         SELECT ls_1.product_id,
            COALESCE(( SELECT sum(il.qty_delta) AS sum
                   FROM inventory_ledger il
                  WHERE il.product_id = ls_1.product_id AND il.occurred_at::date <= ls_1.snapshot_date), 0::bigint) AS ledger_qty
           FROM latest_snapshot ls_1
        )
 SELECT p.id AS product_id,
    p.sku,
    p.product_name,
    p.variant_name,
    ls.snapshot_date,
    ls.counted_qty,
    lq.ledger_qty,
        CASE
            WHEN ls.product_id IS NULL THEN NULL::bigint
            ELSE ls.counted_qty - lq.ledger_qty
        END AS discrepancy,
        CASE
            WHEN ls.product_id IS NULL THEN '未盤點'::text
            ELSE NULL::text
        END AS status_note
   FROM products p
     LEFT JOIN latest_snapshot ls ON ls.product_id = p.id
     LEFT JOIN ledger_qty_as_of lq ON lq.product_id = p.id;

CREATE TRIGGER consolidated_shipments_updated_at BEFORE UPDATE ON public.consolidated_shipments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_consolidated_shipments_close_po AFTER UPDATE OF status ON public.consolidated_shipments FOR EACH ROW EXECUTE FUNCTION trg_close_purchase_orders_on_receive();
CREATE TRIGGER domestic_logistics_updated_at BEFORE UPDATE ON public.domestic_logistics FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_inventory_ledger_no_delete BEFORE DELETE ON public.inventory_ledger FOR EACH ROW EXECUTE FUNCTION trg_inventory_ledger_no_delete();
CREATE TRIGGER trg_inventory_ledger_no_update BEFORE UPDATE ON public.inventory_ledger FOR EACH ROW EXECUTE FUNCTION trg_inventory_ledger_immutable();
CREATE TRIGGER product_selections_updated_at BEFORE UPDATE ON public.product_selections FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER po_updated_at BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_receiving_record_items_ledger AFTER INSERT ON public.receiving_record_items FOR EACH ROW EXECUTE FUNCTION trg_receiving_item_to_ledger();
CREATE TRIGGER trg_sales_order_items_cost_snapshot BEFORE INSERT OR UPDATE OF product_id ON public.sales_order_items FOR EACH ROW EXECUTE FUNCTION trg_sales_item_cost_snapshot();
CREATE TRIGGER trg_sales_order_items_ledger AFTER INSERT ON public.sales_order_items FOR EACH ROW EXECUTE FUNCTION trg_sales_item_to_ledger();
CREATE TRIGGER trg_sales_order_items_remap_ledger AFTER UPDATE OF product_id ON public.sales_order_items FOR EACH ROW EXECUTE FUNCTION trg_sales_item_remap_ledger();
CREATE TRIGGER trg_sales_orders_cancel_ledger AFTER UPDATE ON public.sales_orders FOR EACH ROW EXECUTE FUNCTION trg_sales_order_cancel_reversal();

ALTER TABLE public.ad_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consolidated_shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consolidated_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domestic_logistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domestic_logistics_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receiving_record_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receiving_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY authenticated_whitelist ON public.ad_costs AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.app_users AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.competitor_products AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.consolidated_shipment_items AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.consolidated_shipments AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.domestic_logistics AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.domestic_logistics_items AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.inventory_ledger AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.operating_expenses AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.product_selections AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.product_variants AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.products AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.purchase_order_items AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.purchase_orders AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.receiving_record_items AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.receiving_records AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.sales_order_items AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.sales_orders AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));
CREATE POLICY authenticated_whitelist ON public.stock_snapshots AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid]))) WITH CHECK ((auth.uid() = ANY (ARRAY['d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid])));

REVOKE ALL ON TABLE public.ad_costs FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.app_users FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.competitor_products FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.consolidated_shipment_items FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.consolidated_shipments FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.domestic_logistics FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.domestic_logistics_items FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.inventory_ledger FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.operating_expenses FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.product_selections FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.product_variants FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.products FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.purchase_order_items FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.purchase_orders FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.receiving_record_items FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.receiving_records FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.sales_order_items FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.sales_orders FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.stock_snapshots FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.v_dashboard_kpi FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.v_monthly_profitability FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.v_monthly_revenue FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.v_product_profitability FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.v_product_sales FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.v_product_sold FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.v_products_with_stock FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.v_reorder_suggestions FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.v_stock_current FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.v_stock_reconciliation FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ad_costs TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ad_costs TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ad_costs TO service_role;
GRANT SELECT ON TABLE public.app_users TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.app_users TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competitor_products TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competitor_products TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competitor_products TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.consolidated_shipment_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.consolidated_shipment_items TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.consolidated_shipment_items TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.consolidated_shipments TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.consolidated_shipments TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.consolidated_shipments TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.domestic_logistics TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.domestic_logistics TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.domestic_logistics TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.domestic_logistics_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.domestic_logistics_items TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.domestic_logistics_items TO service_role;
GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE public.inventory_ledger TO anon;
GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE public.inventory_ledger TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_ledger TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.operating_expenses TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.operating_expenses TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.operating_expenses TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_selections TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_selections TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_selections TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_variants TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_variants TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_variants TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_order_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_order_items TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_order_items TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_orders TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_orders TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_orders TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.receiving_record_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.receiving_record_items TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.receiving_record_items TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.receiving_records TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.receiving_records TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.receiving_records TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_order_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_order_items TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_order_items TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_orders TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_orders TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_orders TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.stock_snapshots TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.stock_snapshots TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.stock_snapshots TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_dashboard_kpi TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_dashboard_kpi TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_dashboard_kpi TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_monthly_profitability TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_monthly_profitability TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_monthly_profitability TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_monthly_revenue TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_monthly_revenue TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_monthly_revenue TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_profitability TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_profitability TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_profitability TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_sales TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_sales TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_sales TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_sold TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_sold TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_products_with_stock TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_products_with_stock TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_products_with_stock TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_reorder_suggestions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_reorder_suggestions TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_stock_current TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_stock_current TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_stock_current TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_stock_reconciliation TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_stock_reconciliation TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_stock_reconciliation TO service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(p_po_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(p_po_id bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_consolidated_shipment(p jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_consolidated_shipment(p jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(p jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(p jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_cancelled_status(s text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_cancelled_status(s text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_cancelled_status(s text) TO service_role;
GRANT EXECUTE ON FUNCTION public.item_net_on_product(p_item_id bigint, p_product_id bigint) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.item_net_on_product(p_item_id bigint, p_product_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.item_net_on_product(p_item_id bigint, p_product_id bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.ledger_item_adjust(p_item_id bigint, p_product_id bigint, p_delta integer, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_item_adjust(p_item_id bigint, p_product_id bigint, p_delta integer, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.po_product_shipped_qty(p_po_number text, p_product_id bigint, p_received_only boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.po_product_shipped_qty(p_po_number text, p_product_id bigint, p_received_only boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.product_last_count_date(p_product_id bigint) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_last_count_date(p_product_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_last_count_date(p_product_id bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.receive_shipment(p_shipment_id bigint, p_items jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_shipment(p_shipment_id bigint, p_items jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sale_covered_by_stocktake(p_product_id bigint, p_order_id bigint) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sale_covered_by_stocktake(p_product_id bigint, p_order_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sale_covered_by_stocktake(p_product_id bigint, p_order_id bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_stocktake(p_items jsonb, p_ref text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_stocktake(p_items jsonb, p_ref text) TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_close_purchase_orders_on_receive() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_close_purchase_orders_on_receive() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_close_purchase_orders_on_receive() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_close_purchase_orders_on_receive() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_inventory_ledger_immutable() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_inventory_ledger_immutable() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_inventory_ledger_immutable() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_inventory_ledger_immutable() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_inventory_ledger_no_delete() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_inventory_ledger_no_delete() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_inventory_ledger_no_delete() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_inventory_ledger_no_delete() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_receiving_item_to_ledger() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_receiving_item_to_ledger() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_receiving_item_to_ledger() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_receiving_item_to_ledger() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_cost_snapshot() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_cost_snapshot() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_cost_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_cost_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_remap_ledger() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_remap_ledger() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_remap_ledger() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_remap_ledger() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_to_ledger() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_to_ledger() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_to_ledger() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_sales_item_to_ledger() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sales_order_cancel_reversal() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_sales_order_cancel_reversal() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_sales_order_cancel_reversal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_sales_order_cancel_reversal() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_purchase_order(p_po_id bigint, p jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_purchase_order(p_po_id bigint, p jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.update_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at() TO service_role;
REVOKE ALL ON SEQUENCE public.ad_costs_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.competitor_products_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.consolidated_shipment_items_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.consolidated_shipments_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.domestic_logistics_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.domestic_logistics_items_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.inventory_ledger_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.operating_expenses_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.product_selections_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.product_variants_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.products_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.purchase_order_items_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.purchase_orders_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.receiving_record_items_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.receiving_records_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.sales_order_items_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.sales_orders_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.stock_snapshots_id_seq FROM anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.ad_costs_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.ad_costs_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.ad_costs_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.competitor_products_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.competitor_products_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.competitor_products_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.consolidated_shipment_items_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.consolidated_shipment_items_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.consolidated_shipment_items_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.consolidated_shipments_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.consolidated_shipments_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.consolidated_shipments_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.domestic_logistics_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.domestic_logistics_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.domestic_logistics_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.domestic_logistics_items_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.domestic_logistics_items_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.domestic_logistics_items_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.inventory_ledger_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.inventory_ledger_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.inventory_ledger_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.operating_expenses_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.operating_expenses_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.operating_expenses_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_selections_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_selections_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_selections_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_variants_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_variants_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_variants_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.products_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.products_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.products_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_order_items_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_order_items_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_order_items_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_orders_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_orders_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_orders_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.receiving_record_items_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.receiving_record_items_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.receiving_record_items_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.receiving_records_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.receiving_records_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.receiving_records_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_order_items_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_order_items_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_order_items_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_orders_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_orders_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_orders_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.stock_snapshots_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.stock_snapshots_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.stock_snapshots_id_seq TO service_role;

COMMENT ON TABLE public.inventory_ledger IS '庫存帳本（append-only）。不能改（trg_inventory_ledger_no_update，只放行 note）、不能刪（trg_inventory_ledger_no_delete；清測試資料時同一交易先 SET LOCAL youwu.allow_ledger_delete = ''on''）。錯帳一律新增反向沖銷列。created_by＝寫入的登入者，NULL＝系統匯入或 2026-11-08 前舊資料。';
COMMENT ON COLUMN public.inventory_ledger.created_by IS '寫入這筆異動的登入者（auth.uid()）；NULL＝匯入腳本等系統寫入，或 2026-11-08 以前的舊紀錄';
