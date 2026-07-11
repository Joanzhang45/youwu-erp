-- 011_fix_cogs_cancelled_orders.sql
-- 有物 ERP 前端改版 M4 前置 — 統一口徑：作廢訂單（status='不成立'）不計入 COGS/營收
-- 對應：010_monthly_profitability_view.sql 交付時發現的 DB-repo drift + main 2026-07-12 裁決
--
-- 背景（3 個 view 的 live 現況，執行前用 pg_get_viewdef 直查 DB 核實，不信 repo 檔案）：
--   1. v_monthly_revenue：live 定義已有 `WHERE status <> '不成立'`，但 repo 的 003/006
--      migration 檔完全沒有這行——有人直接在 Dashboard SQL Editor 手動補丁，未回寫 migration。
--   2. v_dashboard_kpi：live 定義同樣**已經**在外層 `WHERE status <> '不成立'`、COGS 子查詢
--      也已 JOIN sales_orders 並濾掉作廢訂單——同一次手動補丁應該有做，只是同樣沒進 repo。
--      （010 交付摘要曾誤判「v_dashboard_kpi 未濾作廢訂單」，那是照 repo 舊檔案推論、沒有
--      實際 pg_get_viewdef 驗證 v_dashboard_kpi 本身導致的誤報，本檔一併訂正。）
--   3. v_monthly_profitability（010 新建）：**唯一真的漏濾**的 view——cogs_months／
--      order_months 兩個 CTE 都沒有 status 過濾，98 筆作廢訂單（177 items／318 件）的成本
--      被算進 COGS，且部分月份作廢訂單金額非 0（並非全部月份都像 2026-01 那樣剛好是 0，
--      全時加總營收因此比 v_dashboard_kpi 全時營收多出約 7,627 元），毛利/淨利雙重低估。
--
-- 本次動作：
--   A. v_dashboard_kpi／v_monthly_revenue：CREATE OR REPLACE 但 **SQL 邏輯與 live 現況
--      完全相同**（不改行為，純粹把已經在跑的定義回填進 repo，消除 drift）。
--   B. v_monthly_profitability：**真的改行為**——order_months／cogs_months 兩個 CTE
--      補上 `AND so.status <> '不成立'`，讓月度口徑與 v_dashboard_kpi 全時口徑一致
--      （不只 COGS，營收/淨營收也要濾，否則「全月加總」對不上「全時累計」）。
--   C. 三個 view 都維持 `WITH (security_invoker = true)`。
--
-- 紅線：純訂正既有口徑不一致，不改動 18 表資料、不改 policy。

-- ============================================================
-- A1. v_dashboard_kpi — 純回填 repo（行為不變，已於 live DB 生效）
-- ============================================================
CREATE OR REPLACE VIEW v_dashboard_kpi
WITH (security_invoker = true) AS
SELECT
  COUNT(DISTINCT so.id) AS order_count,
  COALESCE(SUM(so.order_amount), 0) AS total_revenue,
  COALESCE(SUM(so.net_revenue), 0) AS total_net_revenue,
  (SELECT COALESCE(SUM(soi.qty * p.unit_cost_ntd), 0)
     FROM sales_order_items soi
     JOIN products p ON p.id = soi.product_id
     JOIN sales_orders so2 ON so2.id = soi.order_id
     WHERE so2.status <> '不成立') AS total_cogs,
  (SELECT COALESCE(SUM(ac.amount), 0) FROM ad_costs ac) AS total_ad_cost,
  (SELECT COALESCE(SUM(oe.amount), 0) FROM operating_expenses oe) AS total_expenses,
  COALESCE(SUM(so.net_revenue), 0)
    - (SELECT COALESCE(SUM(soi.qty * p.unit_cost_ntd), 0)
         FROM sales_order_items soi
         JOIN products p ON p.id = soi.product_id
         JOIN sales_orders so2 ON so2.id = soi.order_id
         WHERE so2.status <> '不成立')
    AS gross_profit,
  COALESCE(SUM(so.net_revenue), 0)
    - (SELECT COALESCE(SUM(soi.qty * p.unit_cost_ntd), 0)
         FROM sales_order_items soi
         JOIN products p ON p.id = soi.product_id
         JOIN sales_orders so2 ON so2.id = soi.order_id
         WHERE so2.status <> '不成立')
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
FROM sales_orders so
WHERE so.status <> '不成立';

-- ============================================================
-- A2. v_monthly_revenue — 純回填 repo（行為不變，已於 live DB 生效）
-- ============================================================
CREATE OR REPLACE VIEW v_monthly_revenue
WITH (security_invoker = true) AS
SELECT
  TO_CHAR(so.order_date::date, 'YYYY-MM') AS month,
  COUNT(*) AS order_count,
  SUM(so.order_amount) AS total_revenue,
  SUM(so.net_revenue) AS net_revenue,
  AVG(so.order_amount) AS avg_order_value
FROM sales_orders so
WHERE so.order_date IS NOT NULL AND so.status <> '不成立'
GROUP BY TO_CHAR(so.order_date::date, 'YYYY-MM')
ORDER BY month DESC;

-- ============================================================
-- B. v_monthly_profitability — 真正的行為修正：order_months／cogs_months
--    兩個 CTE 補上作廢訂單過濾，與 v_dashboard_kpi 全時口徑一致
-- ============================================================
CREATE OR REPLACE VIEW v_monthly_profitability
WITH (security_invoker = true) AS
WITH order_months AS (
  SELECT
    date_trunc('month', so.order_date::date)::date AS month,
    COUNT(*) AS order_count,
    COALESCE(SUM(so.order_amount), 0) AS total_revenue,
    COALESCE(SUM(so.net_revenue), 0) AS total_net_revenue
  FROM sales_orders so
  WHERE so.order_date IS NOT NULL AND so.status <> '不成立'
  GROUP BY date_trunc('month', so.order_date::date)::date
),
cogs_months AS (
  SELECT
    date_trunc('month', so.order_date::date)::date AS month,
    COALESCE(SUM(soi.qty * p.unit_cost_ntd), 0) AS total_cogs
  FROM sales_order_items soi
  JOIN sales_orders so ON so.id = soi.order_id
  JOIN products p ON p.id = soi.product_id
  WHERE so.order_date IS NOT NULL AND so.status <> '不成立'
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
