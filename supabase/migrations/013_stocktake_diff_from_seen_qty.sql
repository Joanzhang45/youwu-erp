-- 013：盤點差異改回「盤點的人當下看到的帳上數」為基準（2026-11-05 審查修正）
--
-- 012 版用送出當下的帳上數算差異，會在「點完某項之後、送出之前」有出貨或點收時算錯：
-- 例如點到 10 件、按下「帳上一致」，接著匯入一筆賣出 1 件（帳上變 9），送出時會被記成 +1。
-- 正確的調整量是「點到的數量 − 點的那一刻帳上數」，那一刻的帳上數就是畫面上顯示的數字，
-- 由前端以 expected_qty 傳進來。沒傳 expected_qty 時才退回用送出當下的帳上數。
-- 快照照舊記實際點到的數量；note 裡的帳上數改成記盤點當下看到的那個數。

CREATE OR REPLACE FUNCTION submit_stocktake(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  today_tpe date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  ref text := 'ST-' || (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
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

GRANT EXECUTE ON FUNCTION submit_stocktake(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION submit_stocktake(jsonb) FROM anon, public;
