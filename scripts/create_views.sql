-- =============================================
-- 有物 ERP — Supabase Database Views
-- 用法：貼到 Supabase Dashboard → SQL Editor → Run
-- =============================================

-- 1. Dashboard KPI View
-- 一次查詢取得所有 KPI 數字，取代前端 4 個 API + reduce 計算
CREATE OR REPLACE VIEW v_dashboard_kpi AS
SELECT
  -- 訂單統計
  COUNT(DISTINCT so.id) AS order_count,
  COALESCE(SUM(so.order_amount), 0) AS total_revenue,
  COALESCE(SUM(so.net_revenue), 0) AS total_net_revenue,
  -- 銷貨成本（落地成本 x 銷量）
  (SELECT COALESCE(SUM(p.unit_cost_ntd * p.total_sold_qty), 0) FROM products p) AS total_cogs,
  -- 廣告費
  (SELECT COALESCE(SUM(ac.amount), 0) FROM ad_costs ac) AS total_ad_cost,
  -- 營業費用
  (SELECT COALESCE(SUM(oe.amount), 0) FROM operating_expenses oe) AS total_expenses,
  -- 毛利 = 淨營收 - COGS
  COALESCE(SUM(so.net_revenue), 0)
    - (SELECT COALESCE(SUM(p.unit_cost_ntd * p.total_sold_qty), 0) FROM products p)
    AS gross_profit,
  -- 淨利 = 毛利 - 廣告 - 營業費用
  COALESCE(SUM(so.net_revenue), 0)
    - (SELECT COALESCE(SUM(p.unit_cost_ntd * p.total_sold_qty), 0) FROM products p)
    - (SELECT COALESCE(SUM(ac.amount), 0) FROM ad_costs ac)
    - (SELECT COALESCE(SUM(oe.amount), 0) FROM operating_expenses oe)
    AS net_profit,
  -- 庫存警示
  (SELECT COUNT(*) FROM products p WHERE p.stock_qty <= 0) AS out_of_stock_count,
  (SELECT COUNT(*) FROM products p WHERE p.safety_stock IS NOT NULL AND p.stock_qty > 0 AND p.stock_qty <= p.safety_stock) AS low_stock_count
FROM sales_orders so;

-- 2. 商品損益 View
-- 計算每個商品的單件利潤、毛利率、總利潤，取代前端 map/sort
CREATE OR REPLACE VIEW v_product_profitability AS
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
  p.total_sold_qty,
  p.total_sales_revenue,
  p.product_status,
  p.product_positioning,
  -- 平台費用
  COALESCE(p.selling_price * p.platform_fee_rate / 100, 0) AS platform_fees,
  -- 單件利潤 = 售價 - 成本 - 平台費
  CASE WHEN p.selling_price > 0
    THEN p.selling_price - COALESCE(p.unit_cost_ntd, 0) - (p.selling_price * COALESCE(p.platform_fee_rate, 0) / 100)
    ELSE 0
  END AS unit_profit,
  -- 毛利率
  CASE WHEN p.selling_price > 0
    THEN (p.selling_price - COALESCE(p.unit_cost_ntd, 0) - (p.selling_price * COALESCE(p.platform_fee_rate, 0) / 100)) / p.selling_price
    ELSE 0
  END AS margin,
  -- 總利潤 = 單件利潤 x 銷量
  CASE WHEN p.selling_price > 0
    THEN (p.selling_price - COALESCE(p.unit_cost_ntd, 0) - (p.selling_price * COALESCE(p.platform_fee_rate, 0) / 100)) * COALESCE(p.total_sold_qty, 0)
    ELSE 0
  END AS total_profit
FROM products p
WHERE p.selling_price IS NOT NULL AND p.selling_price > 0;

-- 3. 月度營收 View
-- 按月彙總訂單營收，用於趨勢分析
CREATE OR REPLACE VIEW v_monthly_revenue AS
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

-- 4. 商品銷售統計 View（從 order items 即時計算，不依賴 products 快取欄位）
CREATE OR REPLACE VIEW v_product_sales AS
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
