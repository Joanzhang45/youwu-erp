-- 002_inventory_ledger.sql
-- 有物 ERP Stage A Phase 1 — 庫存日誌制（結構層）
-- 只建結構，不灌資料；期初盤點建帳與四條寫入路徑接線留 Phase 2。
-- 對應 PRD D4／StageA 開發計畫 §Phase 1 C。

-- ============================================================
-- 1. movement_type enum
-- ============================================================
CREATE TYPE movement_type_enum AS ENUM (
  'purchase_receive',  -- 驗收入庫
  'sale_ship',         -- 訂單出貨
  'manual_adjust',     -- 手動調整
  'return_reversal'    -- 退貨取消回沖
);

-- ============================================================
-- 2. inventory_ledger（庫存日誌本表）
-- ============================================================
CREATE TABLE inventory_ledger (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  movement_type movement_type_enum NOT NULL,
  qty_delta INTEGER NOT NULL,     -- 入庫正數／出庫負數
  ref_type TEXT,                  -- 來源類型：purchase_order / sales_order / receiving_record / manual...
  ref_no TEXT,                    -- 來源單號（冪等去重用）
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 同一來源單號對同商品同動作類型只入帳一次，防重複灌帳
  CONSTRAINT uq_inventory_ledger_dedup UNIQUE (movement_type, ref_type, ref_no, product_id)
);

CREATE INDEX idx_inventory_ledger_product ON inventory_ledger(product_id);
CREATE INDEX idx_inventory_ledger_occurred ON inventory_ledger(occurred_at);

-- ============================================================
-- 3. v_stock_current — per-product 現時庫存（SUM 推導，非快取）
-- ============================================================
CREATE VIEW v_stock_current
WITH (security_invoker = true) AS
SELECT
  product_id,
  SUM(qty_delta) AS stock_qty
FROM inventory_ledger
GROUP BY product_id;

-- ============================================================
-- 4. RLS（照 D9：啟用、不建 anon/authenticated policy = 預設拒）
-- ============================================================
ALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;
