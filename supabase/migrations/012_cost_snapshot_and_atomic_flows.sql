-- 012：2026-11-05 健檢第一批（錢與庫存算對）
--
-- 1. sales_order_items.unit_cost_at_sale：賣出當下的成本快照。之前所有毛利都即時 join
--    products.unit_cost_ntd，新一批貨點收改了成本，過去每個月的毛利就跟著變。現有資料用
--    「現在的成本」回填，所以套用當下所有報表數字不變；之後新匯入的品項由 trigger 自動帶入。
-- 2. 兩個損益 view 改用快照成本（沒有快照才退回商品目前成本）。
-- 3. platform_fee_rate 統一為百分比數字 12.9（訂單級實測口徑）：線上混存 14.5 與 0.145 兩種單位，
--    0.145 那批只會扣到 0.145%；14.5% 已查無依據作廢。加 CHECK 防止再存成小數。
-- 4. receive_shipment()：點收整批在一個交易內完成（點收單、品項、庫存帳、成本、集運單狀態），
--    同一張集運單只能點收一次；總重或總運費沒填就拒絕，不再把總重當 1 公斤。
--    進價優先用該批採購單的單價、匯率用該批採購單的匯率（不再用全庫最新一張）。
-- 5. submit_stocktake()：盤點差異在送出當下對照「當時的帳上數」計算（不是開始盤點時的快照），
--    同一天重盤同一商品改為覆蓋當天紀錄，不再整批失敗。
-- 6. 唯一索引當最後防線：同一張集運單不能有兩筆點收單；同一筆廣告費不能匯入兩次。
-- 兩支函式都是 SECURITY INVOKER，照常受 RLS 白名單管。

BEGIN;

-- 1 ───────────────────────────────────────────────
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS unit_cost_at_sale NUMERIC(12,4);

UPDATE sales_order_items soi
   SET unit_cost_at_sale = p.unit_cost_ntd
  FROM products p
 WHERE p.id = soi.product_id
   AND soi.unit_cost_at_sale IS NULL;

CREATE OR REPLACE FUNCTION trg_sales_item_cost_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_sales_order_items_cost_snapshot ON sales_order_items;
CREATE TRIGGER trg_sales_order_items_cost_snapshot
  BEFORE INSERT OR UPDATE OF product_id ON sales_order_items
  FOR EACH ROW EXECUTE FUNCTION trg_sales_item_cost_snapshot();

-- 2 ───────────────────────────────────────────────
-- 以線上現行定義為底做字串替換（011 已註明線上 view 有手動修過、repo 沒同步，不能拿 repo 舊檔重建）。
DO $$
DECLARE
  v text;
  def text;
  old_expr constant text := '((soi.qty)::numeric * p.unit_cost_ntd)';
  new_expr constant text := '((soi.qty)::numeric * COALESCE(soi.unit_cost_at_sale, p.unit_cost_ntd))';
BEGIN
  FOREACH v IN ARRAY ARRAY['v_dashboard_kpi', 'v_monthly_profitability'] LOOP
    def := pg_get_viewdef(v::regclass);
    IF position(old_expr IN def) = 0 THEN
      RAISE EXCEPTION '% 的成本算式和預期不同，停止套用', v;
    END IF;
    def := rtrim(replace(def, old_expr, new_expr), E'; \n');
    EXECUTE format('CREATE OR REPLACE VIEW %I WITH (security_invoker = true) AS %s', v, def);
  END LOOP;
END;
$$;

-- 3 ───────────────────────────────────────────────
UPDATE products SET platform_fee_rate = 12.9 WHERE platform_fee_rate IS DISTINCT FROM 12.9;
ALTER TABLE products ALTER COLUMN platform_fee_rate SET DEFAULT 12.9;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_platform_fee_rate_pct;
ALTER TABLE products ADD CONSTRAINT products_platform_fee_rate_pct
  CHECK (platform_fee_rate IS NULL OR platform_fee_rate BETWEEN 1 AND 100);

-- 6 ───────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_receiving_records_shipment
  ON receiving_records (shipment_number) WHERE shipment_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_costs_date_amount_desc
  ON ad_costs (ad_date, amount, (COALESCE(description, '')));

-- 4 ───────────────────────────────────────────────
-- p_items: [{ "id": consolidated_shipment_items.id, "actual_qty": int, "condition": "良好"|"異常", "notes": text }]
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

    -- 庫存帳由 receiving_record_items 的 AFTER INSERT trigger 寫入（product_id 為空則不入帳）
    INSERT INTO receiving_record_items (receiving_id, product_id, product_name, variant_name,
                                        expected_qty, actual_qty, condition, notes)
    VALUES (rv_id, csi.product_id, csi.product_name, csi.variant_name,
            COALESCE(csi.qty, 0), qty, COALESCE(it ->> 'condition', '良好'), NULLIF(it ->> 'notes', ''));

    IF csi.product_id IS NULL THEN
      n_unlinked := n_unlinked + 1;
      CONTINUE;
    END IF;
    IF qty > 0 THEN
      n_stocked := n_stocked + 1;
    ELSE
      CONTINUE;
    END IF;

    -- 進價：該批採購單上這個商品的單價；沒有才用商品主檔進價
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

    -- 匯率：該批採購單的匯率（排除明顯錯填的值）；沒有才用最近一張合理匯率，再沒有用 4.6
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

-- 5 ───────────────────────────────────────────────
-- p_items: [{ "product_id": bigint, "counted_qty": int }]
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
  book int;
  diff int;
  n int := 0;
  n_diff int := 0;
  details jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    pid := (it ->> 'product_id')::bigint;
    counted := (it ->> 'counted_qty')::int;
    IF pid IS NULL OR counted IS NULL OR counted < 0 THEN
      RAISE EXCEPTION 'BAD_ITEM %', it;
    END IF;
    -- 鎖住這個商品，避免同時有人點收／調整時算錯差異
    PERFORM 1 FROM products WHERE id = pid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND %', pid;
    END IF;
    SELECT COALESCE(sum(qty_delta), 0) INTO book FROM inventory_ledger WHERE product_id = pid;
    diff := counted - book;

    INSERT INTO stock_snapshots (product_id, counted_qty, snapshot_date, note)
    VALUES (pid, counted, today_tpe,
            CASE WHEN diff = 0 THEN '盤點：與帳上一致'
                 ELSE format('盤點差異：帳上 %s → 實際 %s（%s%s）', book, counted, CASE WHEN diff > 0 THEN '+' ELSE '' END, diff) END)
    ON CONFLICT (product_id, snapshot_date)
    DO UPDATE SET counted_qty = EXCLUDED.counted_qty, note = EXCLUDED.note, created_at = now();

    IF diff <> 0 THEN
      INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, note)
      VALUES (pid, 'manual_adjust', diff, 'stocktake_adjust', ref, '盤點修正');
      n_diff := n_diff + 1;
    END IF;
    n := n + 1;
    details := details || jsonb_build_object('product_id', pid, 'book', book, 'counted', counted, 'diff', diff);
  END LOOP;

  RETURN jsonb_build_object('count', n, 'diff_count', n_diff, 'ref_no', ref, 'items', details);
END;
$$;

GRANT EXECUTE ON FUNCTION receive_shipment(bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_stocktake(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION receive_shipment(bigint, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION submit_stocktake(jsonb) FROM anon, public;

COMMIT;
