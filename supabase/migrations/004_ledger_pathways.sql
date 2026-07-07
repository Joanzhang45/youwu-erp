-- 004_ledger_pathways.sql
-- 有物 ERP Stage A Phase 2 — 庫存日誌制：四條寫入路徑（trigger 層）＋ 月度盤點對帳骨架
-- 對應 PRD D4／StageA 開發計畫 §Phase 2；驗收契約 § 9 #6/#7。
-- 可獨立回滾層：本檔只動 trigger／function／新表，不動 products 既有欄位（見 006）。

-- ============================================================
-- A. 路徑① receiving_record_items INSERT → purchase_receive
--    只在 NEW.product_id 有值時記帳（歷史匯入資料 product_id 全為 NULL，
--    trigger 只對「本檔上線後」的新 INSERT 生效，不會回頭幫歷史列補記，
--    也因此不會和期初建帳（005）重複計入，見 005 開頭說明）。
-- ============================================================
CREATE OR REPLACE FUNCTION trg_receiving_item_to_ledger() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, occurred_at)
  VALUES (NEW.product_id, 'purchase_receive', COALESCE(NEW.actual_qty, 0), 'receiving_record_item', NEW.id::text, NOW())
  ON CONFLICT (movement_type, ref_type, ref_no, product_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_receiving_record_items_ledger ON receiving_record_items;
CREATE TRIGGER trg_receiving_record_items_ledger
AFTER INSERT ON receiving_record_items
FOR EACH ROW EXECUTE FUNCTION trg_receiving_item_to_ledger();

-- ============================================================
-- B. 路徑② sales_order_items INSERT → sale_ship（qty 負）
--    同樣只對 NEW.product_id 有值生效；3 筆歷史「補寄/漏寄」catch-all
--    項目 product_id 為 NULL，非本檔上線後新增，不受影響。
-- ============================================================
CREATE OR REPLACE FUNCTION trg_sales_item_to_ledger() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, occurred_at)
  VALUES (NEW.product_id, 'sale_ship', -COALESCE(NEW.qty, 0), 'sales_order_item', NEW.id::text, NOW())
  ON CONFLICT (movement_type, ref_type, ref_no, product_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_order_items_ledger ON sales_order_items;
CREATE TRIGGER trg_sales_order_items_ledger
AFTER INSERT ON sales_order_items
FOR EACH ROW EXECUTE FUNCTION trg_sales_item_to_ledger();

-- ============================================================
-- C. 路徑③ sales_orders 狀態 UPDATE 為取消/退貨類 → 對該單所有 items 寫 return_reversal（qty 正）
--    2026-07-07 實查 sales_orders.status 實際值域（829 筆）：
--      已完成(723) / 不成立(69) / 已送達(9) / 已完成(鑑賞期內)...(7+5+5+5+3+2) / 運送中(1)
--    目前資料只有「不成立」是取消語意（該 69 筆 order_amount/net_revenue 皆為 0.00，
--    證實從未出貨）；「鑑賞期內」系列仍是「已完成」的子狀態，不算取消。
--    條件用關鍵字比對而非硬編「不成立」四字，防未來 Shopee 匯入出現其他退貨/取消措辭
--    （中/英文皆涵蓋）；ON CONFLICT 防同一筆狀態被多次改成一樣的取消值時重複回沖。
-- ============================================================
CREATE OR REPLACE FUNCTION trg_sales_order_cancel_reversal() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IS NOT NULL
     AND NEW.status ~* '不成立|取消|退貨|退款|cancel|refund|return' THEN
    INSERT INTO inventory_ledger (product_id, movement_type, qty_delta, ref_type, ref_no, occurred_at, note)
    SELECT soi.product_id, 'return_reversal', COALESCE(soi.qty, 0), 'sales_order_item', soi.id::text, NOW(),
           '訂單 ' || COALESCE(NEW.order_number, NEW.id::text) || ' 狀態轉為「' || NEW.status || '」自動回沖'
    FROM sales_order_items soi
    WHERE soi.order_id = NEW.id AND soi.product_id IS NOT NULL
    ON CONFLICT (movement_type, ref_type, ref_no, product_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_orders_cancel_ledger ON sales_orders;
CREATE TRIGGER trg_sales_orders_cancel_ledger
AFTER UPDATE ON sales_orders
FOR EACH ROW EXECUTE FUNCTION trg_sales_order_cancel_reversal();

-- ============================================================
-- D. 路徑④ manual_adjust — 不做 trigger，前端／腳本直接 INSERT INTO inventory_ledger
--    （見 src/app/inventory/page.tsx handleStockUpdate；movement_type 已存在於 002 的 enum）
-- ============================================================

-- ============================================================
-- E. 月度盤點對帳：snapshot 表 ＋ 對帳 View
-- ============================================================
CREATE TABLE stock_snapshots (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  counted_qty INTEGER NOT NULL,
  snapshot_date DATE NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stock_snapshots_product_date UNIQUE (product_id, snapshot_date)
);

ALTER TABLE stock_snapshots ENABLE ROW LEVEL SECURITY;

-- 對帳 View：每個商品取「最新一筆盤點」對比同一天 ledger 推導庫存的差異；
-- 無盤點紀錄的商品顯示「未盤點」，不當作差異=0（避免誤判成「已對過帳」）。
CREATE VIEW v_stock_reconciliation
WITH (security_invoker = true) AS
WITH latest_snapshot AS (
  SELECT DISTINCT ON (product_id) product_id, counted_qty, snapshot_date, note
  FROM stock_snapshots
  ORDER BY product_id, snapshot_date DESC
),
ledger_qty_as_of AS (
  SELECT ls.product_id,
         COALESCE((SELECT SUM(il.qty_delta) FROM inventory_ledger il
                    WHERE il.product_id = ls.product_id AND il.occurred_at::date <= ls.snapshot_date), 0) AS ledger_qty
  FROM latest_snapshot ls
)
SELECT
  p.id AS product_id,
  p.sku,
  p.product_name,
  p.variant_name,
  ls.snapshot_date,
  ls.counted_qty,
  lq.ledger_qty,
  CASE WHEN ls.product_id IS NULL THEN NULL ELSE ls.counted_qty - lq.ledger_qty END AS discrepancy,
  CASE WHEN ls.product_id IS NULL THEN '未盤點' ELSE NULL END AS status_note
FROM products p
LEFT JOIN latest_snapshot ls ON ls.product_id = p.id
LEFT JOIN ledger_qty_as_of lq ON lq.product_id = p.id;

-- ============================================================
-- F. 舊表清理：stock_movements（2 筆 03-18 測試資料，已於 2026-07-07 雙地備份
--    本機 youwu-erp-data\supabase-backup-2026-07-07\stock_movements.json
--    Mac Mini ~/backups/youwu-erp/supabase-backup-2026-07-07/stock_movements.json）
--    schema 與新 inventory_ledger（enum 型別＋冪等唯一鍵）不相容，Phase 1 盤點已建議砍掉重建。
-- ============================================================
DROP TABLE IF EXISTS stock_movements;
