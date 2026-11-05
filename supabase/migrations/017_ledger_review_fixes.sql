-- 017：016 獨立審查修正（2026-11-06）
--
-- 1. 「盤點涵蓋」也認 7/16～7/17 依蝦皮後台庫存直接校正的紀錄（ref_type = shopee_stocktake_sync），
--    之後補匯入 7/7 以後的訂單時，已被那次校正反映的出貨不再重扣。
-- 2. 改對應改用「這個品項在這個商品上的淨扣帳」判斷：來回改對應（A→B→A）不會多回沖或漏扣；
--    原商品沒有淨扣帳（004 上線前的歷史品項，出貨已含在期初餘額）就整筆不動，不在新商品上重扣。
-- 3. 取消回沖：改用淨扣帳；「不成立」（沒出貨）且扣帳之後又盤點過的品項不回沖——盤點時貨還在架上，
--    盤點已經把它補回帳上，再回沖會多算一份。真正退貨（貨回來了）的狀態照常回沖。
-- 4. submit_stocktake：先上鎖再檢查是否已送出，重送不會撞重複鍵報錯。

BEGIN;

-- 該商品最近一次「盤點或依蝦皮校正」的日期（台北時間）
CREATE OR REPLACE FUNCTION product_last_count_date(p_product_id bigint) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT GREATEST(
    (SELECT max(snapshot_date) FROM stock_snapshots WHERE product_id = p_product_id),
    (SELECT max((occurred_at AT TIME ZONE 'Asia/Taipei')::date) FROM inventory_ledger
      WHERE product_id = p_product_id AND ref_type IN ('shopee_stocktake_sync', 'stocktake_adjust')));
$$;

CREATE OR REPLACE FUNCTION sale_covered_by_stocktake(p_product_id bigint, p_order_id bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM sales_orders so
     WHERE so.id = p_order_id AND so.order_date IS NOT NULL
       AND so.order_date < product_last_count_date(p_product_id));
$$;

-- 某品項在某商品上的淨扣帳（負數＝目前扣著幾件）
CREATE OR REPLACE FUNCTION item_net_on_product(p_item_id bigint, p_product_id bigint) RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(qty_delta), 0)::int FROM inventory_ledger
   WHERE product_id = p_product_id
     AND ((ref_type = 'sales_order_item' AND ref_no = p_item_id::text)
       OR (ref_type = 'sales_item_remap' AND ref_no LIKE p_item_id::text || ':%'));
$$;

-- 寫一筆品項調整：優先用標準的 sale_ship／return_reversal 列（一個品項一個商品各一筆），
-- 那一列已經用掉時改寫 sales_item_remap 調整列（帶時間戳，不會撞唯一鍵）
CREATE OR REPLACE FUNCTION ledger_item_adjust(p_item_id bigint, p_product_id bigint, p_delta int, p_note text) RETURNS void
LANGUAGE plpgsql AS $$
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
$$;

-- 2 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_sales_item_remap_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
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
$$;

-- 3 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_sales_order_cancel_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
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
$$;

-- 4 ───────────────────────────────────────────────
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
$$;

REVOKE EXECUTE ON FUNCTION product_last_count_date(bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION item_net_on_product(bigint, bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION ledger_item_adjust(bigint, bigint, int, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION ledger_item_adjust(bigint, bigint, int, text) TO authenticated;

COMMIT;
