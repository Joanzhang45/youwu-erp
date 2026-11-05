-- 016：第二次健檢「先修 8 項」的資料庫部分（2026-11-06）
--
-- 1. 盤點後才匯入的舊訂單不再重複扣庫存：訂單日期早於該商品最近一次盤點日期（stock_snapshots），
--    表示那次出貨在盤點時已經不在架上、盤點數已經反映，就不再寫 sale_ship。
--    同一天的訂單仍照扣（分不出在盤點前或後，照扣比漏扣安全，下次盤點會校正）。
-- 2. 取消回沖只回沖「真的扣過」的品項：配合第 1 點，沒扣過的品項取消時不能把庫存加回來。
-- 3. 「蝦皮對應」事後把品項改對應到商品時，庫存帳跟著動：撤回原商品已扣的出貨，對新商品補扣
--    （同樣遵守第 1、2 點；訂單已取消則不補扣）。
-- 4. submit_stocktake 加送出代號（p_ref）：同一次盤點重送不會重複調整（斷線重按的情況）。
-- 5. cancel_purchase_order()：已點收或已有集運批次的採購單不能取消（畫面讀取失敗時也擋得住）。

BEGIN;

CREATE OR REPLACE FUNCTION is_cancelled_status(s text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT s IS NOT NULL AND s ~* '不成立|取消|退貨|退款|cancel|refund|return';
$$;

-- 這張訂單的出貨是否已被該商品之後的盤點涵蓋
CREATE OR REPLACE FUNCTION sale_covered_by_stocktake(p_product_id bigint, p_order_id bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM sales_orders so
     WHERE so.id = p_order_id AND so.order_date IS NOT NULL
       AND so.order_date < (SELECT max(snapshot_date) FROM stock_snapshots WHERE product_id = p_product_id));
$$;

-- 1 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_sales_item_to_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.product_id IS NULL OR sale_covered_by_stocktake(NEW.product_id, NEW.order_id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, occurred_at)
  VALUES (NEW.product_id, 'sale_ship', -COALESCE(NEW.qty, 0), 'sales_order_item', NEW.id::text, NOW())
  ON CONFLICT (movement_type, ref_type, ref_no, product_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 2 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_sales_order_cancel_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND is_cancelled_status(NEW.status) THEN
    INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, occurred_at, note)
    SELECT soi.product_id, 'return_reversal', COALESCE(soi.qty, 0), 'sales_order_item', soi.id::text, NOW(),
           '訂單 ' || COALESCE(NEW.order_number, NEW.id::text) || ' 狀態轉為「' || NEW.status || '」自動回沖'
      FROM sales_order_items soi
     WHERE soi.order_id = NEW.id AND soi.product_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM inventory_ledger il
                    WHERE il.movement_type = 'sale_ship' AND il.ref_type = 'sales_order_item'
                      AND il.ref_no = soi.id::text AND il.product_id = soi.product_id)
    ON CONFLICT (movement_type, ref_type, ref_no, product_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- 3 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_sales_item_remap_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
  tag text := NEW.id::text || ':' || (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  IF NEW.product_id IS NOT DISTINCT FROM OLD.product_id THEN
    RETURN NEW;
  END IF;
  SELECT status INTO st FROM sales_orders WHERE id = NEW.order_id;

  -- 撤回原商品「已扣且未回沖」的出貨
  IF OLD.product_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM inventory_ledger WHERE movement_type = 'sale_ship' AND ref_type = 'sales_order_item'
                    AND ref_no = OLD.id::text AND product_id = OLD.product_id)
     AND NOT EXISTS (SELECT 1 FROM inventory_ledger WHERE movement_type = 'return_reversal' AND ref_type = 'sales_order_item'
                    AND ref_no = OLD.id::text AND product_id = OLD.product_id) THEN
    INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, occurred_at, note)
    VALUES (OLD.product_id, 'manual_adjust', COALESCE(OLD.qty, 0), 'sales_item_remap', tag, NOW(),
            '訂單品項改對應到別的商品，撤回原商品的出貨');
  END IF;

  -- 對新商品補扣（訂單已取消、或已被盤點涵蓋則不扣）
  IF NEW.product_id IS NOT NULL AND NOT is_cancelled_status(st)
     AND NOT sale_covered_by_stocktake(NEW.product_id, NEW.order_id) THEN
    INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, occurred_at)
    VALUES (NEW.product_id, 'sale_ship', -COALESCE(NEW.qty, 0), 'sales_order_item', NEW.id::text, NOW())
    ON CONFLICT (movement_type, ref_type, ref_no, product_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_order_items_remap_ledger ON sales_order_items;
CREATE TRIGGER trg_sales_order_items_remap_ledger
  AFTER UPDATE OF product_id ON sales_order_items
  FOR EACH ROW EXECUTE FUNCTION trg_sales_item_remap_ledger();

-- 4 ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS submit_stocktake(jsonb);
CREATE OR REPLACE FUNCTION submit_stocktake(p_items jsonb, p_ref text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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

  -- 同一次盤點重送（例如送出後網路斷了、使用者再按一次）：已經寫過就直接回報，不再調整
  IF p_ref IS NOT NULL AND EXISTS (SELECT 1 FROM inventory_ledger WHERE ref_type = 'stocktake_adjust' AND ref_no = ref) THEN
    RETURN jsonb_build_object('already_submitted', true, 'ref_no', ref,
      'diff_count', (SELECT count(*) FROM inventory_ledger WHERE ref_type = 'stocktake_adjust' AND ref_no = ref));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('stocktake:' || ref));

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
$$;

-- 5 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_purchase_order(p_po_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION submit_stocktake(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_purchase_order(bigint) TO authenticated;
REVOKE EXECUTE ON FUNCTION submit_stocktake(jsonb, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION cancel_purchase_order(bigint) FROM anon, public;
REVOKE EXECUTE ON FUNCTION is_cancelled_status(text) FROM anon;
REVOKE EXECUTE ON FUNCTION sale_covered_by_stocktake(bigint, bigint) FROM anon;

COMMIT;
