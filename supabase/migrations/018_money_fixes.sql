-- 018：第二次健檢「算錢相關」9–17 的資料庫部分（2026-11-06）
--
-- 9.  運費分攤：分母改成這批貨「實收數量 × 單件重量」的總和，整筆運費一定分完；
--     有任何一項沒填重量時，改成按件數平均分，並回報有幾項沒重量（畫面會提醒）。
-- 10. 成本改加權平均：新成本 =（點收前庫存 × 舊成本 + 這次實收 × 這次到貨成本）÷ 兩者件數。
-- 11. 採購單結案、在途數量、可再排集運的數量：已點收的集運批次一律看「實際收到幾件」。
--     點收紀錄加 shipment_item_id 對回集運品項；舊紀錄能唯一對上的回填。
-- 12. 「取消／退貨」只用一個判斷：is_cancelled_status()。
--     修正：「已完成（鑑賞期內，買家仍可申請退貨／退款）」不是退貨，原本會被誤判。
--     sales_orders 加 is_cancelled 欄位（自動算），報表、補貨、畫面都用它；狀態空白算成立。
-- 14. v_products_with_stock 的「已售數量」「預估毛利率」改成即時算，不再讀舊程式寫的欄位。
-- 16. create_purchase_order()：新增採購單一次存好單頭和品項，匯率必填且要在 3～10。

BEGIN;

-- 12 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_cancelled_status(s text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT s IS NOT NULL
     AND s ~* '不成立|取消|退貨|退款|cancel|refund|return'
     AND s !~ '^已完成';
$$;

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS is_cancelled boolean GENERATED ALWAYS AS (is_cancelled_status(status)) STORED;
CREATE INDEX IF NOT EXISTS idx_sales_orders_is_cancelled ON sales_orders (is_cancelled);

CREATE OR REPLACE VIEW v_monthly_revenue WITH (security_invoker = true) AS
 SELECT to_char(order_date::timestamp with time zone, 'YYYY-MM'::text) AS month,
    count(*) AS order_count,
    sum(order_amount) AS total_revenue,
    sum(net_revenue) AS net_revenue,
    avg(order_amount) AS avg_order_value
   FROM sales_orders so
  WHERE order_date IS NOT NULL AND NOT is_cancelled
  GROUP BY (to_char(order_date::timestamp with time zone, 'YYYY-MM'::text))
  ORDER BY (to_char(order_date::timestamp with time zone, 'YYYY-MM'::text)) DESC;

CREATE OR REPLACE VIEW v_monthly_profitability WITH (security_invoker = true) AS
 WITH order_months AS (
         SELECT date_trunc('month'::text, so.order_date::timestamp with time zone)::date AS month,
            count(*) AS order_count,
            COALESCE(sum(so.order_amount), 0::numeric) AS total_revenue,
            COALESCE(sum(so.net_revenue), 0::numeric) AS total_net_revenue
           FROM sales_orders so
          WHERE so.order_date IS NOT NULL AND NOT so.is_cancelled
          GROUP BY (date_trunc('month'::text, so.order_date::timestamp with time zone)::date)
        ), cogs_months AS (
         SELECT date_trunc('month'::text, so.order_date::timestamp with time zone)::date AS month,
            COALESCE(sum(soi.qty::numeric * COALESCE(soi.unit_cost_at_sale, p.unit_cost_ntd)), 0::numeric) AS total_cogs
           FROM sales_order_items soi
             JOIN sales_orders so ON so.id = soi.order_id
             JOIN products p ON p.id = soi.product_id
          WHERE so.order_date IS NOT NULL AND NOT so.is_cancelled
          GROUP BY (date_trunc('month'::text, so.order_date::timestamp with time zone)::date)
        ), ad_months AS (
         SELECT date_trunc('month'::text, ac.ad_date::timestamp with time zone)::date AS month,
            COALESCE(sum(ac.amount), 0::numeric) AS total_ad_cost
           FROM ad_costs ac
          WHERE ac.ad_date IS NOT NULL
          GROUP BY (date_trunc('month'::text, ac.ad_date::timestamp with time zone)::date)
        ), expense_months AS (
         SELECT date_trunc('month'::text, oe.expense_date::timestamp with time zone)::date AS month,
            COALESCE(sum(oe.amount), 0::numeric) AS total_expenses
           FROM operating_expenses oe
          WHERE oe.expense_date IS NOT NULL
          GROUP BY (date_trunc('month'::text, oe.expense_date::timestamp with time zone)::date)
        ), all_months AS (
         SELECT order_months.month FROM order_months
        UNION
         SELECT ad_months.month FROM ad_months
        UNION
         SELECT expense_months.month FROM expense_months
        )
 SELECT am.month,
    COALESCE(om.order_count, 0::bigint) AS order_count,
    COALESCE(om.total_revenue, 0::numeric) AS total_revenue,
    COALESCE(om.total_net_revenue, 0::numeric) AS total_net_revenue,
    COALESCE(cm.total_cogs, 0::numeric) AS total_cogs,
    COALESCE(om.total_net_revenue, 0::numeric) - COALESCE(cm.total_cogs, 0::numeric) AS gross_profit,
    COALESCE(adm.total_ad_cost, 0::numeric) AS total_ad_cost,
    COALESCE(exm.total_expenses, 0::numeric) AS total_expenses,
    COALESCE(om.total_net_revenue, 0::numeric) - COALESCE(cm.total_cogs, 0::numeric) - COALESCE(adm.total_ad_cost, 0::numeric) - COALESCE(exm.total_expenses, 0::numeric) AS net_profit
   FROM all_months am
     LEFT JOIN order_months om ON om.month = am.month
     LEFT JOIN cogs_months cm ON cm.month = am.month
     LEFT JOIN ad_months adm ON adm.month = am.month
     LEFT JOIN expense_months exm ON exm.month = am.month
  ORDER BY am.month DESC;

CREATE OR REPLACE VIEW v_dashboard_kpi WITH (security_invoker = true) AS
 WITH cogs AS (
   SELECT COALESCE(sum(soi.qty::numeric * COALESCE(soi.unit_cost_at_sale, p.unit_cost_ntd)), 0::numeric) AS v
     FROM sales_order_items soi
     JOIN products p ON p.id = soi.product_id
     JOIN sales_orders so2 ON so2.id = soi.order_id
    WHERE NOT so2.is_cancelled
 ), ad AS (SELECT COALESCE(sum(amount), 0::numeric) AS v FROM ad_costs),
    ex AS (SELECT COALESCE(sum(amount), 0::numeric) AS v FROM operating_expenses)
 SELECT count(DISTINCT so.id) AS order_count,
    COALESCE(sum(so.order_amount), 0::numeric) AS total_revenue,
    COALESCE(sum(so.net_revenue), 0::numeric) AS total_net_revenue,
    (SELECT v FROM cogs) AS total_cogs,
    (SELECT v FROM ad) AS total_ad_cost,
    (SELECT v FROM ex) AS total_expenses,
    COALESCE(sum(so.net_revenue), 0::numeric) - (SELECT v FROM cogs) AS gross_profit,
    COALESCE(sum(so.net_revenue), 0::numeric) - (SELECT v FROM cogs) - (SELECT v FROM ad) - (SELECT v FROM ex) AS net_profit,
    (SELECT count(*) FROM products p LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id
      WHERE COALESCE(vsc.stock_qty, 0::bigint) <= 0) AS out_of_stock_count,
    (SELECT count(*) FROM products p LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id
      WHERE p.safety_stock IS NOT NULL AND COALESCE(vsc.stock_qty, 0::bigint) > 0
        AND COALESCE(vsc.stock_qty, 0::bigint) <= p.safety_stock) AS low_stock_count
   FROM sales_orders so
  WHERE NOT so.is_cancelled;

-- 成立訂單的商品銷售彙總（排行、商品頁共用）
CREATE OR REPLACE VIEW v_product_sold WITH (security_invoker = true) AS
 SELECT soi.product_id,
    sum(soi.qty)::int AS sold_qty,
    sum(soi.subtotal) AS sold_revenue
   FROM sales_order_items soi
   JOIN sales_orders so ON so.id = soi.order_id
  WHERE soi.product_id IS NOT NULL AND NOT so.is_cancelled
  GROUP BY soi.product_id;

CREATE OR REPLACE VIEW v_product_sales WITH (security_invoker = true) AS
 SELECT soi.product_id,
    p.product_name,
    p.variant_name,
    count(*) AS order_item_count,
    sum(soi.qty) AS total_qty,
    sum(soi.subtotal) AS total_revenue,
    avg(soi.unit_price) AS avg_unit_price
   FROM sales_order_items soi
     JOIN sales_orders so ON so.id = soi.order_id
     LEFT JOIN products p ON p.id = soi.product_id
  WHERE soi.product_id IS NOT NULL AND NOT so.is_cancelled
  GROUP BY soi.product_id, p.product_name, p.variant_name;

CREATE OR REPLACE VIEW v_product_profitability WITH (security_invoker = true) AS
 SELECT p.id,
    p.product_name,
    p.variant_name,
    p.sku,
    p.category,
    p.selling_price,
    p.unit_cost_ntd,
    p.platform_fee_rate,
    COALESCE(vsc.stock_qty, 0::bigint)::integer AS stock_qty,
    COALESCE(ps.sold_qty, 0)::integer AS total_sold_qty,
    COALESCE(ps.sold_revenue, 0::numeric)::numeric(12,2) AS total_sales_revenue,
    p.product_status,
    p.product_positioning,
    COALESCE(p.selling_price * p.platform_fee_rate / 100::numeric, 0::numeric) AS platform_fees,
        CASE WHEN p.selling_price > 0::numeric
             THEN p.selling_price - COALESCE(p.unit_cost_ntd, 0::numeric) - p.selling_price * COALESCE(p.platform_fee_rate, 0::numeric) / 100::numeric
             ELSE 0::numeric END AS unit_profit,
        CASE WHEN p.selling_price > 0::numeric
             THEN (p.selling_price - COALESCE(p.unit_cost_ntd, 0::numeric) - p.selling_price * COALESCE(p.platform_fee_rate, 0::numeric) / 100::numeric) / p.selling_price
             ELSE 0::numeric END AS margin,
        CASE WHEN p.selling_price > 0::numeric
             THEN (p.selling_price - COALESCE(p.unit_cost_ntd, 0::numeric) - p.selling_price * COALESCE(p.platform_fee_rate, 0::numeric) / 100::numeric) * COALESCE(ps.sold_qty, 0)::numeric
             ELSE 0::numeric END AS total_profit
   FROM products p
     LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id
     LEFT JOIN v_product_sold ps ON ps.product_id = p.id
  WHERE p.selling_price IS NOT NULL AND p.selling_price > 0::numeric;

-- 14 ───────────────────────────────────────────────
CREATE OR REPLACE VIEW v_products_with_stock WITH (security_invoker = true) AS
 SELECT p.id, p.product_name, p.sku, p.category, p.variant_name, p.selection_number, p.shopee_spec_id,
    p.order_link, p.product_positioning, p.product_image, p.notes, p.selling_price, p.purchase_price_cny,
    p.product_status, p.domestic_shipping_thrown, p.unit_cost_ntd, p.domestic_shipping_per_unit_cny,
    p.initial_order_qty, p.domestic_shipping_per_unit_thrown, p.platform_fee_rate, p.avg_daily_sales,
    p.avg_shipping_days, p.unit_profit, p.weight_kg, p.safety_stock, p.total_purchased_qty,
    p.total_purchase_cost, p.avg_purchase_price, p.current_stock_cost,
    COALESCE(ps.sold_qty, 0)::integer AS total_sold_qty,
    p.total_sales_revenue,
    -- 預估毛利率：用現在的售價、成本、平台費率算（小數，0.35 = 35%）
    CASE WHEN p.selling_price > 0 AND p.unit_cost_ntd IS NOT NULL
         THEN round((p.selling_price - p.unit_cost_ntd - p.selling_price * COALESCE(p.platform_fee_rate, 0) / 100) / p.selling_price, 4)
    END::numeric(10,6) AS gross_margin,
    p.realized_profit, p.total_shipped_qty, p.shopee_fee_total, p.net_revenue_subtotal, p.first_order_date,
    p.total_order_days, p.latest_po_number, p.created_at, p.updated_at,
    COALESCE(vsc.stock_qty, 0::bigint)::integer AS stock_qty
   FROM products p
     LEFT JOIN v_stock_current vsc ON vsc.product_id = p.id
     LEFT JOIN v_product_sold ps ON ps.product_id = p.id;

-- 11 ───────────────────────────────────────────────
ALTER TABLE receiving_record_items ADD COLUMN IF NOT EXISTS shipment_item_id bigint REFERENCES consolidated_shipment_items(id);
CREATE INDEX IF NOT EXISTS idx_rri_shipment_item ON receiving_record_items (shipment_item_id);

-- 舊點收紀錄：同一批集運裡同一商品只有一項時，才能確定對到哪一項
UPDATE receiving_record_items rri
   SET shipment_item_id = m.csi_id
  FROM (
    SELECT rri2.id AS rri_id, min(csi.id) AS csi_id
      FROM receiving_record_items rri2
      JOIN receiving_records rr ON rr.id = rri2.receiving_id
      JOIN consolidated_shipments cs ON cs.shipment_number = rr.shipment_number
      JOIN consolidated_shipment_items csi ON csi.shipment_id = cs.id AND csi.product_id = rri2.product_id
     WHERE rri2.shipment_item_id IS NULL AND rri2.product_id IS NOT NULL
     GROUP BY rri2.id
    HAVING count(*) = 1
  ) m
 WHERE rri.id = m.rri_id;

-- 已排集運的件數；已點收的批次改看實際收到幾件（對不回點收紀錄的舊資料才用排的件數）
CREATE OR REPLACE FUNCTION po_product_shipped_qty(p_po_number text, p_product_id bigint, p_received_only boolean)
RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(
           CASE WHEN cs.status IN ('已驗收', '已入庫')
                THEN COALESCE((SELECT sum(rri.actual_qty) FROM receiving_record_items rri WHERE rri.shipment_item_id = csi.id), csi.qty)
                ELSE csi.qty END), 0)::int
    FROM consolidated_shipment_items csi
    JOIN consolidated_shipments cs ON cs.id = csi.shipment_id
   WHERE csi.po_number = p_po_number
     AND csi.product_id = p_product_id
     AND (NOT p_received_only OR cs.status IN ('已驗收', '已入庫'));
$$;

-- 補貨建議：銷量只算成立訂單
CREATE OR REPLACE VIEW v_reorder_suggestions WITH (security_invoker = true) AS
 WITH last_day AS (
         SELECT COALESCE(max(sales_orders.order_date), (now() AT TIME ZONE 'Asia/Taipei'::text)::date) AS d
           FROM sales_orders
        ), sold AS (
         SELECT soi.product_id, sum(soi.qty)::numeric AS qty_60d
           FROM sales_order_items soi
             JOIN sales_orders so ON so.id = soi.order_id
          WHERE so.order_date > ((SELECT last_day.d FROM last_day) - 60) AND NOT so.is_cancelled AND soi.product_id IS NOT NULL
          GROUP BY soi.product_id
        ), on_order AS (
         SELECT x.product_id,
            sum(GREATEST(x.ordered - po_product_shipped_qty(x.po_number, x.product_id, true), 0::bigint)) AS qty
           FROM ( SELECT po.po_number, poi.product_id, sum(poi.qty) AS ordered
                   FROM purchase_order_items poi
                     JOIN purchase_orders po ON po.id = poi.po_id
                  WHERE NOT COALESCE(po.status_received, false) AND NOT COALESCE(po.status_cancelled, false) AND poi.product_id IS NOT NULL
                  GROUP BY po.po_number, poi.product_id) x
          GROUP BY x.product_id
        ), base AS (
         SELECT p.id AS product_id, p.product_name, p.variant_name, p.product_image, p.product_status, p.category,
            COALESCE(s.stock_qty, 0::bigint)::integer AS stock_qty,
            COALESCE(o.qty, 0::numeric)::integer AS on_order_qty,
            COALESCE(sd.qty_60d, 0::numeric)::integer AS sold_60d,
            COALESCE(sd.qty_60d, 0::numeric) / 60.0 AS daily_sales_exact,
            COALESCE(p.avg_shipping_days, 21::numeric)::integer AS lead_days,
            p.safety_stock,
            (SELECT last_day.d FROM last_day) AS sales_data_until
           FROM products p
             LEFT JOIN v_stock_current s ON s.product_id = p.id
             LEFT JOIN on_order o ON o.product_id = p.id
             LEFT JOIN sold sd ON sd.product_id = p.id
          WHERE COALESCE(p.product_status, ''::text) <> ALL (ARRAY['停售'::text, '測品'::text, '季節款'::text])
        )
 SELECT product_id, product_name, variant_name, product_image, product_status, category, stock_qty, on_order_qty,
    sold_60d, round(daily_sales_exact, 2) AS daily_sales, lead_days, safety_stock, sales_data_until,
        CASE WHEN daily_sales_exact > 0::numeric THEN floor(GREATEST(stock_qty, 0)::numeric / daily_sales_exact)::integer
             ELSE NULL::integer END AS days_left,
    GREATEST(ceil(daily_sales_exact * (lead_days + 30)::numeric)::integer - stock_qty - on_order_qty,
             COALESCE(safety_stock, 0) - stock_qty - on_order_qty, 0) AS suggest_qty
   FROM base b;

-- 9、10、11 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION receive_shipment(p_shipment_id bigint, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
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
  freight_unit numeric;
  landed numeric;
  old_cost numeric;
  stock_before numeric;
  total_wq numeric := 0;
  total_q numeric := 0;
  n_no_weight int := 0;
  by_qty boolean;
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

  -- 先算這批貨的分攤基準：實收件數 × 單件重量（含沒對到商品的品項，它們也佔運費）
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO csi FROM consolidated_shipment_items
     WHERE id = (it ->> 'id')::bigint AND shipment_id = p_shipment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_IN_SHIPMENT %', it ->> 'id';
    END IF;
    qty := GREATEST(COALESCE((it ->> 'actual_qty')::int, 0), 0);
    CONTINUE WHEN qty = 0;
    SELECT COALESCE(NULLIF(csi.weight_kg, 0), NULLIF(p.weight_kg, 0)) INTO w
      FROM (SELECT 1) one LEFT JOIN products p ON p.id = csi.product_id;
    total_q := total_q + qty;
    IF w IS NULL THEN
      n_no_weight := n_no_weight + 1;
    ELSE
      total_wq := total_wq + qty * w;
    END IF;
  END LOOP;
  -- 有任何一項沒重量就改按件數平均分，確保整筆運費都分出去
  by_qty := n_no_weight > 0 OR total_wq <= 0;

  SELECT cny_rate INTO fallback_rate FROM purchase_orders
   WHERE cny_rate BETWEEN 3 AND 10 ORDER BY created_at DESC LIMIT 1;

  INSERT INTO receiving_records (receiving_number, shipment_number, receiving_date, receiver)
  VALUES ('RV-' || to_char(today_tpe, 'YYYYMMDD') || '-' || lpad(p_shipment_id::text, 4, '0'),
          ship.shipment_number, today_tpe, COALESCE(auth.jwt() ->> 'email', 'manual'))
  RETURNING id INTO rv_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO csi FROM consolidated_shipment_items
     WHERE id = (it ->> 'id')::bigint AND shipment_id = p_shipment_id;
    qty := GREATEST(COALESCE((it ->> 'actual_qty')::int, 0), 0);
    n_items := n_items + 1;

    IF csi.product_id IS NOT NULL THEN
      -- 鎖住商品，讀「點收前」的庫存與成本（下面的 INSERT 會觸發入庫）
      SELECT unit_cost_ntd INTO old_cost FROM products WHERE id = csi.product_id FOR UPDATE;
      SELECT COALESCE(sum(qty_delta), 0) INTO stock_before FROM inventory_ledger WHERE product_id = csi.product_id;
    END IF;

    INSERT INTO receiving_record_items (receiving_id, product_id, product_name, variant_name,
                                        expected_qty, actual_qty, condition, notes, photo_path, shipment_item_id)
    VALUES (rv_id, csi.product_id, csi.product_name, csi.variant_name,
            COALESCE(csi.qty, 0), qty, COALESCE(it ->> 'condition', '良好'), NULLIF(it ->> 'notes', ''),
            NULLIF(it ->> 'photo_path', ''), csi.id);

    IF csi.product_id IS NULL THEN
      n_unlinked := n_unlinked + 1;
      CONTINUE;
    END IF;
    IF qty > 0 THEN
      n_stocked := n_stocked + 1;
    ELSE
      CONTINUE;
    END IF;

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

    SELECT cny_rate INTO rate FROM purchase_orders
     WHERE po_number = csi.po_number AND cny_rate BETWEEN 3 AND 10;
    rate := COALESCE(rate, fallback_rate, 4.6);

    IF by_qty THEN
      freight_unit := ship.total_cost_ntd / total_q;
    ELSE
      SELECT COALESCE(NULLIF(csi.weight_kg, 0), NULLIF(p.weight_kg, 0)) INTO w FROM products p WHERE p.id = csi.product_id;
      freight_unit := w * ship.total_cost_ntd / total_wq;
    END IF;
    landed := price * rate * (1 + card_fee / 100) + freight_unit;

    -- 加權平均：點收前還有庫存且有成本，才和舊成本平均
    IF stock_before > 0 AND old_cost IS NOT NULL AND old_cost > 0 THEN
      landed := (stock_before * old_cost + qty * landed) / (stock_before + qty);
    END IF;

    UPDATE products
       SET unit_cost_ntd = round(landed, 2), latest_po_number = ship.shipment_number
     WHERE id = csi.product_id;
    n_cost := n_cost + 1;
  END LOOP;

  UPDATE consolidated_shipments SET status = '已驗收', updated_at = now() WHERE id = p_shipment_id;

  RETURN jsonb_build_object(
    'receiving_id', rv_id, 'items', n_items, 'stocked', n_stocked,
    'unlinked', n_unlinked, 'cost_updated', n_cost, 'cost_skipped', n_cost_skipped,
    'freight_by_qty', by_qty, 'no_weight', n_no_weight);
END;
$$;

-- 16 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_purchase_order(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  od date := COALESCE(NULLIF(p ->> 'order_date', '')::date, (now() AT TIME ZONE 'Asia/Taipei')::date);
  prefix text := 'PO-' || to_char(od, 'YYYYMMDD') || '-';
  rate numeric := NULLIF(p ->> 'cny_rate', '')::numeric;
  seq int;
  num text;
  pid bigint;
  it jsonb;
  pr products%ROWTYPE;
  q int;
  price numeric;
  sub numeric := 0;
  n int := 0;
BEGIN
  IF rate IS NULL OR rate < 3 OR rate > 10 THEN RAISE EXCEPTION 'BAD_RATE'; END IF;
  IF jsonb_typeof(p -> 'items') <> 'array' OR jsonb_array_length(p -> 'items') = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('purchase_order_number'));
  SELECT COALESCE(max(substring(po_number FROM length(prefix) + 1)::int), 0) + 1 INTO seq
    FROM purchase_orders
   WHERE po_number LIKE prefix || '%' AND substring(po_number FROM length(prefix) + 1) ~ '^\d+$';
  num := prefix || lpad(seq::text, 3, '0');

  INSERT INTO purchase_orders (po_number, purchaser, order_date, cny_rate, notes, status,
                               status_draft, status_confirmed, status_ordered, status_paid, status_shipping,
                               status_warehouse_received, status_warehouse_stored, status_return_shipping,
                               status_received, status_cancelled, status_abnormal)
  VALUES (num, COALESCE(NULLIF(trim(p ->> 'purchaser'), ''), '張瓊安'), od, rate, NULLIF(trim(p ->> 'notes'), ''), 'ordered',
          false, false, true, false, false, false, false, false, false, false, 0)
  RETURNING id INTO pid;

  FOR it IN SELECT * FROM jsonb_array_elements(p -> 'items') LOOP
    q := (it ->> 'qty')::int;
    price := (it ->> 'unit_price_cny')::numeric;
    IF q IS NULL OR q <= 0 OR price IS NULL OR price <= 0 THEN RAISE EXCEPTION 'BAD_ITEM %', it; END IF;
    SELECT * INTO pr FROM products WHERE id = (it ->> 'product_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND %', it ->> 'product_id'; END IF;
    INSERT INTO purchase_order_items (po_id, product_id, product_name, variant_name, product_image, qty, unit_price_cny, subtotal_cny)
    VALUES (pid, pr.id, pr.product_name, pr.variant_name, pr.product_image, q, price, round(q * price, 4));
    sub := sub + round(q * price, 4);
    n := n + 1;
  END LOOP;

  UPDATE purchase_orders
     SET subtotal_cny = sub, total_payment_cny = sub, grand_total = sub, total_payment_ntd = round(sub * rate, 2)
   WHERE id = pid;

  RETURN jsonb_build_object('id', pid, 'po_number', num, 'items', n);
END;
$$;

GRANT EXECUTE ON FUNCTION create_purchase_order(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION create_purchase_order(jsonb) FROM anon, public;
GRANT SELECT ON v_product_sold TO authenticated;
REVOKE ALL ON v_product_sold FROM anon;

COMMIT;
