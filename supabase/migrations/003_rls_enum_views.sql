-- 003_rls_enum_views.sql
-- 有物 ERP Stage A Phase 1 — RLS 收斂／狀態 enum／View 安全化
-- 對應 PRD D5／D9、StageA 開發計畫 §Phase 1 D。
--
-- 2026-07-07 盤點結論（見交付摘要）：
--   - 17 張實體表 rowsecurity 已全數 = true（event trigger `ensure_rls`／rls_auto_enable
--     自動掛上，非殘留，予以保留不 DROP）；僅 products / purchase_orders / stock_movements
--     3 表殘留 `FOR ALL TO {anon,authenticated} USING (true)` 全開 policy，其餘 14 表本來就是
--     「RLS on + 無 policy = 預設拒」。
--   - 4 個既有 View（v_dashboard_kpi / v_product_profitability / v_monthly_revenue /
--     v_product_sales）皆被 Supabase Advisor 標記 CRITICAL「Security Definer View」，且
--     經 anon key 實測證實會繞過表層 RLS 直接吐出真實營收／淨利（sales_orders 本身回空集合，
--     但 view 回真實數字）——這是比 D9 描述更嚴重的現況，本檔一併堵上（security_invoker=true）。

-- ============================================================
-- A. RLS 收斂：移除既有全開 policy
-- ============================================================
DROP POLICY IF EXISTS allow_all_anon_products ON products;
DROP POLICY IF EXISTS allow_all_authenticated_products ON products;
DROP POLICY IF EXISTS allow_all_anon_po ON purchase_orders;
DROP POLICY IF EXISTS allow_all_authenticated_po ON purchase_orders;
DROP POLICY IF EXISTS allow_all_anon_sm ON stock_movements;
DROP POLICY IF EXISTS allow_all_authenticated_sm ON stock_movements;

-- 保險：17 張實體表 + inventory_ledger 顯式再次確保 RLS 開啟（idempotent，不影響已開表）
ALTER TABLE ad_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE consolidated_shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE consolidated_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE domestic_logistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE domestic_logistics_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE receiving_record_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE receiving_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;
-- 無任何 anon/authenticated policy = 預設拒（D9）；demo 資料在前端 demo-data.ts，不需 DB demo 表。

-- ============================================================
-- B. 採購單狀態 enum（D5：10 個 status_* boolean → 單一 status）
-- ============================================================
CREATE TYPE po_status_enum AS ENUM (
  'draft', 'confirmed', 'ordered', 'paid', 'shipping',
  'warehouse_received', 'warehouse_stored', 'return_shipping',
  'received', 'cancelled'
);

ALTER TABLE purchase_orders ADD COLUMN status po_status_enum;

-- 回填：依生命週期優先序取「已達最後階段」；93 筆盤點顯示多數（72 筆）10 個 boolean 全為
-- false（真正狀態實際記在 logistics_status/payment_status 兩個雜亂文字欄，見交付摘要），
-- 故 ELSE 預設 draft。
UPDATE purchase_orders SET status = CASE
  WHEN status_cancelled THEN 'cancelled'
  WHEN status_received THEN 'received'
  WHEN status_return_shipping THEN 'return_shipping'
  WHEN status_warehouse_stored THEN 'warehouse_stored'
  WHEN status_warehouse_received THEN 'warehouse_received'
  WHEN status_shipping THEN 'shipping'
  WHEN status_paid THEN 'paid'
  WHEN status_ordered THEN 'ordered'
  WHEN status_confirmed THEN 'confirmed'
  WHEN status_draft THEN 'draft'
  ELSE 'draft'
END::po_status_enum;

ALTER TABLE purchase_orders ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE purchase_orders ALTER COLUMN status SET NOT NULL;
-- 舊 10 個 boolean 欄位保留不 DROP（可回滾原則；Phase 2 後視前端改用 status 情況再評估移除）

-- ============================================================
-- C. View 安全化＋即時 JOIN 取代 stale 聚合欄
--    （products.total_sold_qty / total_sales_revenue 是 refresh_stats.py 手動維護的快照，
--     此後這 2 個 View 改直接 JOIN sales_order_items 即時算）
-- ============================================================
CREATE OR REPLACE VIEW v_dashboard_kpi
WITH (security_invoker = true) AS
SELECT
  COUNT(DISTINCT so.id) AS order_count,
  COALESCE(SUM(so.order_amount), 0) AS total_revenue,
  COALESCE(SUM(so.net_revenue), 0) AS total_net_revenue,
  (SELECT COALESCE(SUM(soi.qty * p.unit_cost_ntd), 0)
     FROM sales_order_items soi JOIN products p ON p.id = soi.product_id) AS total_cogs,
  (SELECT COALESCE(SUM(ac.amount), 0) FROM ad_costs ac) AS total_ad_cost,
  (SELECT COALESCE(SUM(oe.amount), 0) FROM operating_expenses oe) AS total_expenses,
  COALESCE(SUM(so.net_revenue), 0)
    - (SELECT COALESCE(SUM(soi.qty * p.unit_cost_ntd), 0)
         FROM sales_order_items soi JOIN products p ON p.id = soi.product_id)
    AS gross_profit,
  COALESCE(SUM(so.net_revenue), 0)
    - (SELECT COALESCE(SUM(soi.qty * p.unit_cost_ntd), 0)
         FROM sales_order_items soi JOIN products p ON p.id = soi.product_id)
    - (SELECT COALESCE(SUM(ac.amount), 0) FROM ad_costs ac)
    - (SELECT COALESCE(SUM(oe.amount), 0) FROM operating_expenses oe)
    AS net_profit,
  (SELECT COUNT(*) FROM products p WHERE p.stock_qty <= 0) AS out_of_stock_count,
  (SELECT COUNT(*) FROM products p WHERE p.safety_stock IS NOT NULL AND p.stock_qty > 0 AND p.stock_qty <= p.safety_stock) AS low_stock_count
FROM sales_orders so;

CREATE OR REPLACE VIEW v_product_profitability
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.product_name,
  p.variant_name,
  p.sku,
  p.category,
  p.selling_price,
  p.unit_cost_ntd,
  p.platform_fee_rate,
  p.stock_qty,
  COALESCE(soi_agg.total_qty, 0)::integer AS total_sold_qty,
  COALESCE(soi_agg.total_revenue, 0)::numeric(12,2) AS total_sales_revenue,
  p.product_status,
  p.product_positioning,
  COALESCE(p.selling_price * p.platform_fee_rate / 100, 0) AS platform_fees,
  CASE WHEN p.selling_price > 0
    THEN p.selling_price - COALESCE(p.unit_cost_ntd, 0) - (p.selling_price * COALESCE(p.platform_fee_rate, 0) / 100)
    ELSE 0
  END AS unit_profit,
  CASE WHEN p.selling_price > 0
    THEN (p.selling_price - COALESCE(p.unit_cost_ntd, 0) - (p.selling_price * COALESCE(p.platform_fee_rate, 0) / 100)) / p.selling_price
    ELSE 0
  END AS margin,
  CASE WHEN p.selling_price > 0
    THEN (p.selling_price - COALESCE(p.unit_cost_ntd, 0) - (p.selling_price * COALESCE(p.platform_fee_rate, 0) / 100)) * COALESCE(soi_agg.total_qty, 0)
    ELSE 0
  END AS total_profit
FROM products p
LEFT JOIN (
  SELECT product_id, SUM(qty) AS total_qty, SUM(subtotal) AS total_revenue
  FROM sales_order_items
  GROUP BY product_id
) soi_agg ON soi_agg.product_id = p.id
WHERE p.selling_price IS NOT NULL AND p.selling_price > 0;

CREATE OR REPLACE VIEW v_monthly_revenue
WITH (security_invoker = true) AS
SELECT
  TO_CHAR(so.order_date::date, 'YYYY-MM') AS month,
  COUNT(*) AS order_count,
  SUM(so.order_amount) AS total_revenue,
  SUM(so.net_revenue) AS net_revenue,
  AVG(so.order_amount) AS avg_order_value
FROM sales_orders so
WHERE so.order_date IS NOT NULL
GROUP BY TO_CHAR(so.order_date::date, 'YYYY-MM')
ORDER BY month DESC;

-- 第 4 個既有 View（本已即時計算、不依賴 stale 欄位），一併補上 security_invoker 關閉
-- Advisor CRITICAL 警示（非 spec 指定 3 View 之一，但同一根因，順手關閉零額外風險）
CREATE OR REPLACE VIEW v_product_sales
WITH (security_invoker = true) AS
SELECT
  soi.product_id,
  p.product_name,
  p.variant_name,
  COUNT(*) AS order_item_count,
  SUM(soi.qty) AS total_qty,
  SUM(soi.subtotal) AS total_revenue,
  AVG(soi.unit_price) AS avg_unit_price
FROM sales_order_items soi
LEFT JOIN products p ON p.id = soi.product_id
WHERE soi.product_id IS NOT NULL
GROUP BY soi.product_id, p.product_name, p.variant_name;

-- ============================================================
-- D. rls_auto_enable — 盤點確認為現行生效中的 event trigger（ensure_rls），
--    非舊時代殘留，予以保留、不 DROP（詳見交付摘要 B 段）
-- ============================================================
-- （本節故意留白，不下 DROP FUNCTION / DROP EVENT TRIGGER）
