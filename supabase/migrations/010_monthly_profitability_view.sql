-- 010_monthly_profitability_view.sql
-- 有物 ERP 前端改版 M4 前置 — 新增「月度損益」View
-- 對應：有物ERP_前端改版_PRD_v1.md § 5（分析頁預設本月、「賺不賺」首屏答完）
--       § 7.1 M4 已知缺口「KPI 卡缺本月毛利（待 M4 月度 view）」
--
-- 背景：既有 4 個 View（v_dashboard_kpi／v_monthly_revenue／v_product_profitability／
--   v_product_sales）只有「全時累計」與「月度營收（無毛利）」兩種口徑，缺「按月的完整損益」，
--   M2「今天」頁與 M4 分析頁都需要「本月毛利/淨利」但現有 view 給不出。
--
-- 口徑同源：完全比照 v_dashboard_kpi（003_rls_enum_views.sql 最終定義，經 006 再次
--   CREATE OR REPLACE 確認）的計算邏輯，只是從「全時累計」改成「按月 GROUP BY」：
--   - total_revenue    = SUM(sales_orders.order_amount)
--   - total_net_revenue = SUM(sales_orders.net_revenue)（net_revenue 為匯入腳本已算好的
--     實收金額欄：訂單金額 − 成交手續費 − 金流處理費 − 較長備貨費 − 賣場優惠券 − 蝦皮補貼；
--     免運補貼 free_shipping_subsidy 不參與扣除，與現版 analytics 頁一致）
--   - total_cogs       = SUM(sales_order_items.qty × products.unit_cost_ntd)，即時 JOIN
--     （非 products.total_sold_qty 快取欄，避免 003 已修過的 stale 聚合問題重演）
--   - gross_profit     = total_net_revenue − total_cogs
--   - total_ad_cost    = SUM(ad_costs.amount)（按 ad_date 所屬月分組）
--   - total_expenses   = SUM(operating_expenses.amount)（按 expense_date 所屬月分組）
--   - net_profit       = gross_profit − total_ad_cost − total_expenses
--
-- 月份完整性：訂單／廣告／營業費用三個來源各自的月份集合不一定重疊（例如某月只買廣告
--   沒出貨），故用 UNION 取三方月份聯集再 LEFT JOIN 回填，避免「有花錢沒營收的月」被
--   INNER JOIN 悄悄吃掉、害淨利被低估。
--
-- 安全：WITH (security_invoker = true)（PG15+），查詢者權限執行，底層 5 張表已有的 RLS
--   （008/009 authenticated_whitelist、anon 0 policy 預設拒）原樣套用到本 view，不需要
--   對 view 另建 policy（同 003/006/008/009 既有慣例）。
--
-- 紅線：純新增，不改、不砍任何既有 view／表／policy；18 表資料零動。

CREATE VIEW v_monthly_profitability
WITH (security_invoker = true) AS
WITH order_months AS (
  SELECT
    date_trunc('month', so.order_date::date)::date AS month,
    COUNT(*) AS order_count,
    COALESCE(SUM(so.order_amount), 0) AS total_revenue,
    COALESCE(SUM(so.net_revenue), 0) AS total_net_revenue
  FROM sales_orders so
  WHERE so.order_date IS NOT NULL
  GROUP BY date_trunc('month', so.order_date::date)::date
),
cogs_months AS (
  SELECT
    date_trunc('month', so.order_date::date)::date AS month,
    COALESCE(SUM(soi.qty * p.unit_cost_ntd), 0) AS total_cogs
  FROM sales_order_items soi
  JOIN sales_orders so ON so.id = soi.order_id
  JOIN products p ON p.id = soi.product_id
  WHERE so.order_date IS NOT NULL
  GROUP BY date_trunc('month', so.order_date::date)::date
),
ad_months AS (
  SELECT
    date_trunc('month', ac.ad_date)::date AS month,
    COALESCE(SUM(ac.amount), 0) AS total_ad_cost
  FROM ad_costs ac
  WHERE ac.ad_date IS NOT NULL
  GROUP BY date_trunc('month', ac.ad_date)::date
),
expense_months AS (
  SELECT
    date_trunc('month', oe.expense_date)::date AS month,
    COALESCE(SUM(oe.amount), 0) AS total_expenses
  FROM operating_expenses oe
  WHERE oe.expense_date IS NOT NULL
  GROUP BY date_trunc('month', oe.expense_date)::date
),
all_months AS (
  SELECT month FROM order_months
  UNION
  SELECT month FROM ad_months
  UNION
  SELECT month FROM expense_months
)
SELECT
  am.month,
  COALESCE(om.order_count, 0) AS order_count,
  COALESCE(om.total_revenue, 0) AS total_revenue,
  COALESCE(om.total_net_revenue, 0) AS total_net_revenue,
  COALESCE(cm.total_cogs, 0) AS total_cogs,
  COALESCE(om.total_net_revenue, 0) - COALESCE(cm.total_cogs, 0) AS gross_profit,
  COALESCE(adm.total_ad_cost, 0) AS total_ad_cost,
  COALESCE(exm.total_expenses, 0) AS total_expenses,
  COALESCE(om.total_net_revenue, 0) - COALESCE(cm.total_cogs, 0)
    - COALESCE(adm.total_ad_cost, 0) - COALESCE(exm.total_expenses, 0) AS net_profit
FROM all_months am
LEFT JOIN order_months om ON om.month = am.month
LEFT JOIN cogs_months cm ON cm.month = am.month
LEFT JOIN ad_months adm ON adm.month = am.month
LEFT JOIN expense_months exm ON exm.month = am.month
ORDER BY am.month DESC;
