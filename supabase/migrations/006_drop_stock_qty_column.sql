-- 006_drop_stock_qty_column.sql
-- 有物 ERP Stage A Phase 2 -- 移除 products.stock_qty GENERATED 欄（03-18 帳實不符根因：
-- 只算 total_purchased_qty - total_shipped_qty，從未扣銷售），改由 inventory_ledger 推導。
-- 執行順序：必須在 004（trigger）與 005（期初）都上線、且前端已改讀 v_products_with_stock 之後才跑，
-- 否則會打斷還在讀/寫 stock_qty 的舊路徑。前端引用點盤點見交付摘要。

-- ============================================================
-- A. 兩個既有 View 直接讀 p.stock_qty，DROP 欄位前必須先改寫，
--    否則 DROP COLUMN 會因 view 依賴而報錯。
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
  (SELECT COUNT(*) FROM products p
     LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id
     WHERE COALESCE(vsc.stock_qty, 0) <= 0) AS out_of_stock_count,
  (SELECT COUNT(*) FROM products p
     LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id
     WHERE p.safety_stock IS NOT NULL AND COALESCE(vsc.stock_qty, 0) > 0
       AND COALESCE(vsc.stock_qty, 0) <= p.safety_stock) AS low_stock_count
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
  COALESCE(vsc.stock_qty, 0)::integer AS stock_qty,
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
LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id
LEFT JOIN (
  SELECT product_id, SUM(qty) AS total_qty, SUM(subtotal) AS total_revenue
  FROM sales_order_items
  GROUP BY product_id
) soi_agg ON soi_agg.product_id = p.id
WHERE p.selling_price IS NOT NULL AND p.selling_price > 0;

-- ============================================================
-- B. DROP 欄位（前端已改讀 v_products_with_stock，見交付摘要引用點清單；
--    generated column，DROP 前無法先驗證「無引用」用 information_schema 反查依賴，
--    已用 grep src/ 人工核對取代）
-- ============================================================
ALTER TABLE products DROP COLUMN stock_qty;

-- ============================================================
-- C. 建立 v_products_with_stock：products 全欄位 + 即時 stock_qty（取代舊 generated 欄），
--    前端只需把 .from("products") 讀取端改成 .from("v_products_with_stock")，
--    寫入端（update/insert 非庫存欄位）維持指向真表 products，最小改動、不重構其他欄位邏輯。
-- ============================================================
CREATE VIEW v_products_with_stock
WITH (security_invoker = true) AS
SELECT
  p.*,
  COALESCE(vsc.stock_qty, 0)::integer AS stock_qty
FROM products p
LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id;
