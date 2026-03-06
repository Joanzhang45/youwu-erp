-- Youwu ERP Database Schema
-- Based on Ragic database definition (9 tables + subtables)
-- Designed for Supabase (PostgreSQL)

-- ============================================================
-- 1. 選品與成本試算 (Product Selection & Cost Estimation)
-- ============================================================
CREATE TABLE product_selections (
  id BIGSERIAL PRIMARY KEY,
  selection_date DATE,
  selection_number TEXT UNIQUE, -- 選品編號 e.g. "00078"
  product_name TEXT NOT NULL,
  product_image TEXT, -- URL
  cny_rate NUMERIC(6,4) DEFAULT 4.57,
  category TEXT, -- 分類: 收納好物, 餐廚區, 浴室區...
  notes TEXT,
  shipping_method TEXT DEFAULT '海運', -- 海運/空運
  shipping_rate_per_kg NUMERIC(8,2) DEFAULT 42, -- 1公斤集運費(NTD)
  order_link TEXT, -- 1688 URL
  status TEXT DEFAULT '考慮中', -- 考慮中/測品/穩定銷售/停售
  sales_mode TEXT DEFAULT '現貨', -- 現貨/預購
  domestic_shipping_cny NUMERIC(10,4) DEFAULT 0,
  total_purchase_cost_ntd NUMERIC(12,2),
  competitor_max_price NUMERIC(10,2),
  competitor_min_price NUMERIC(10,2),
  total_qty INTEGER,
  total_weight_kg NUMERIC(10,4),
  order_amount_cny NUMERIC(12,4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 選品款式子表 (Variant subtable)
CREATE TABLE product_variants (
  id BIGSERIAL PRIMARY KEY,
  selection_id BIGINT REFERENCES product_selections(id) ON DELETE CASCADE,
  variant_name TEXT, -- 款式名稱
  variant_image TEXT,
  purchase_price_cny NUMERIC(10,4), -- 進貨單價(CNY)
  selling_price_ntd NUMERIC(10,2), -- 售價(NTD)
  weight_kg NUMERIC(8,4),
  domestic_shipping_cny NUMERIC(8,4),
  qty INTEGER DEFAULT 0,
  unit_cost_ntd NUMERIC(10,4), -- 單品成本(NTD) = calculated
  profit_ntd NUMERIC(10,4), -- 單品利潤 = calculated
  margin_pct NUMERIC(6,2), -- 毛利率
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 競品子表
CREATE TABLE competitor_products (
  id BIGSERIAL PRIMARY KEY,
  selection_id BIGINT REFERENCES product_selections(id) ON DELETE CASCADE,
  competitor_name TEXT,
  competitor_price NUMERIC(10,2),
  competitor_link TEXT,
  notes TEXT
);

-- ============================================================
-- 2. 商品資訊 (Product Info - THE MAIN TABLE)
-- ============================================================
CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  product_name TEXT NOT NULL,
  sku TEXT UNIQUE, -- SKU編號
  category TEXT,
  variant_name TEXT, -- 款式/尺寸
  selection_number TEXT, -- 原選品編號 (links to product_selections)
  shopee_spec_id TEXT, -- 蝦皮規格ID
  order_link TEXT, -- 訂貨連結
  product_positioning TEXT, -- 產品定位: 引流款/一般款/利潤款
  product_image TEXT,
  notes TEXT,
  selling_price NUMERIC(10,2), -- 售價(NTD)
  purchase_price_cny NUMERIC(10,4), -- 進貨單價(CNY)
  product_status TEXT DEFAULT '測品', -- 商品狀態: 測品/穩定銷售/停售
  domestic_shipping_thrown NUMERIC(10,4), -- 境內運費(拋轉)
  unit_cost_ntd NUMERIC(10,4), -- 單品成本(NTD)
  domestic_shipping_per_unit_cny NUMERIC(10,4),
  initial_order_qty INTEGER,
  domestic_shipping_per_unit_thrown NUMERIC(10,4),
  platform_fee_rate NUMERIC(6,4) DEFAULT 0.145, -- 蝦皮平台抽成
  avg_daily_sales NUMERIC(8,4),
  avg_shipping_days NUMERIC(8,2),
  unit_profit NUMERIC(10,4), -- 單品利潤
  weight_kg NUMERIC(8,4),
  safety_stock INTEGER, -- 安全庫存量
  -- Aggregated fields (computed or updated by triggers)
  total_purchased_qty INTEGER DEFAULT 0, -- 總進貨數量
  total_purchase_cost NUMERIC(12,2) DEFAULT 0, -- 總進貨成本
  avg_purchase_price NUMERIC(10,4), -- 平均進價
  current_stock_cost NUMERIC(12,2) DEFAULT 0, -- 現有庫存成本
  total_sold_qty INTEGER DEFAULT 0, -- 總銷貨數量
  total_sales_revenue NUMERIC(12,2) DEFAULT 0, -- 總銷貨收入
  gross_margin NUMERIC(6,4), -- 毛利率
  realized_profit NUMERIC(12,2) DEFAULT 0, -- 已實現利得
  total_shipped_qty INTEGER DEFAULT 0, -- 已出貨數量
  shopee_fee_total NUMERIC(12,2) DEFAULT 0, -- 蝦皮手續費支出
  net_revenue_subtotal NUMERIC(12,2) DEFAULT 0, -- 實收營收小計
  first_order_date DATE,
  total_order_days INTEGER,
  latest_po_number TEXT, -- 最新一筆採購單
  -- Stock = total_purchased - total_shipped
  stock_qty INTEGER GENERATED ALWAYS AS (total_purchased_qty - total_shipped_qty) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. 採購單 (Purchase Orders)
-- ============================================================
CREATE TABLE purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  po_number TEXT UNIQUE NOT NULL, -- 採購單號 e.g. PO-20250724-001
  purchaser TEXT, -- 採購人員
  payment_method TEXT, -- 付款方式
  forwarder TEXT, -- 集運商
  forwarder_phone TEXT,
  order_date DATE,
  photo_thumbnail TEXT,
  cny_rate NUMERIC(6,4),
  shipping_rate_per_kg NUMERIC(8,2), -- 集運費(NTD/1Kg)
  logistics_status TEXT DEFAULT '草稿', -- 物流狀態
  total_payment_cny NUMERIC(12,4),
  forwarder_address TEXT,
  notes TEXT,
  total_payment_ntd NUMERIC(12,2),
  payment_status TEXT DEFAULT '未付款', -- 付款狀態
  subtotal_cny NUMERIC(12,4),
  customs_duty NUMERIC(10,2),
  grand_total NUMERIC(12,2),
  -- Status tracking (timestamps for each stage)
  status_draft BOOLEAN DEFAULT FALSE,
  status_confirmed BOOLEAN DEFAULT FALSE,
  status_ordered BOOLEAN DEFAULT FALSE,
  status_paid BOOLEAN DEFAULT FALSE,
  status_shipping BOOLEAN DEFAULT FALSE,
  status_warehouse_received BOOLEAN DEFAULT FALSE,
  status_warehouse_stored BOOLEAN DEFAULT FALSE,
  status_return_shipping BOOLEAN DEFAULT FALSE,
  status_received BOOLEAN DEFAULT FALSE,
  status_cancelled BOOLEAN DEFAULT FALSE,
  status_abnormal INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 採購單明細 (PO Line Items)
CREATE TABLE purchase_order_items (
  id BIGSERIAL PRIMARY KEY,
  po_id BIGINT REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  product_name TEXT,
  variant_name TEXT,
  product_image TEXT,
  qty INTEGER NOT NULL,
  unit_price_cny NUMERIC(10,4),
  subtotal_cny NUMERIC(12,4),
  weight_kg NUMERIC(8,4),
  domestic_shipping_cny NUMERIC(10,4),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. 境內物流追蹤 (Domestic Logistics Tracking)
-- ============================================================
CREATE TABLE domestic_logistics (
  id BIGSERIAL PRIMARY KEY,
  tracking_number TEXT, -- 物流追蹤單號
  po_number TEXT, -- 關聯採購單號
  forwarder TEXT,
  logistics_company TEXT, -- 物流公司
  waybill_number TEXT, -- 物流單號
  shipping_date DATE,
  expected_arrival DATE,
  actual_arrival DATE,
  status TEXT DEFAULT '待出貨', -- 待出貨/運送中/已簽收/已入庫/異常
  total_weight_kg NUMERIC(10,4),
  shipping_cost_cny NUMERIC(10,4),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 物流追蹤單明細
CREATE TABLE domestic_logistics_items (
  id BIGSERIAL PRIMARY KEY,
  logistics_id BIGINT REFERENCES domestic_logistics(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  product_name TEXT,
  variant_name TEXT,
  qty INTEGER,
  weight_kg NUMERIC(8,4),
  notes TEXT
);

-- ============================================================
-- 5. 集運回台 (Consolidated Shipping to Taiwan)
-- ============================================================
CREATE TABLE consolidated_shipments (
  id BIGSERIAL PRIMARY KEY,
  shipment_number TEXT UNIQUE, -- 集運單號
  forwarder TEXT,
  shipping_method TEXT, -- 海運/空運
  departure_date DATE,
  expected_arrival DATE,
  actual_arrival DATE,
  status TEXT DEFAULT '待出貨',
  total_weight_kg NUMERIC(10,4),
  shipping_cost_ntd NUMERIC(12,2),
  customs_duty NUMERIC(10,2),
  total_cost_ntd NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 集運回台明細
CREATE TABLE consolidated_shipment_items (
  id BIGSERIAL PRIMARY KEY,
  shipment_id BIGINT REFERENCES consolidated_shipments(id) ON DELETE CASCADE,
  po_number TEXT,
  product_id BIGINT REFERENCES products(id),
  product_name TEXT,
  variant_name TEXT,
  qty INTEGER,
  weight_kg NUMERIC(8,4),
  notes TEXT
);

-- ============================================================
-- 6. 驗收入庫 (Receiving & Warehousing)
-- ============================================================
CREATE TABLE receiving_records (
  id BIGSERIAL PRIMARY KEY,
  receiving_number TEXT UNIQUE,
  shipment_number TEXT, -- 關聯集運單號
  receiving_date DATE,
  receiver TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 驗收入庫明細
CREATE TABLE receiving_record_items (
  id BIGSERIAL PRIMARY KEY,
  receiving_id BIGINT REFERENCES receiving_records(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  product_name TEXT,
  variant_name TEXT,
  expected_qty INTEGER,
  actual_qty INTEGER,
  discrepancy INTEGER GENERATED ALWAYS AS (actual_qty - expected_qty) STORED,
  condition TEXT DEFAULT '良好', -- 良好/損壞/短缺
  notes TEXT
);

-- ============================================================
-- 7. 銷售訂單 (Sales Orders)
-- ============================================================
CREATE TABLE sales_orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT UNIQUE, -- 蝦皮訂單編號
  order_date DATE,
  buyer_name TEXT,
  -- Fee breakdown (from Shopee)
  order_amount NUMERIC(12,2), -- 訂單金額
  transaction_fee NUMERIC(10,2), -- 成交手續費 5.5%
  free_shipping_subsidy NUMERIC(10,2), -- 免運補貼 7%
  extended_prep_fee NUMERIC(10,2), -- 較長備貨 3%
  payment_processing_fee NUMERIC(10,2), -- 金流處理費 2%
  seller_coupon NUMERIC(10,2), -- 賣場優惠券
  platform_coupon NUMERIC(10,2), -- 蝦皮補貼
  net_revenue NUMERIC(12,2), -- 實收金額
  status TEXT DEFAULT '待出貨', -- 待出貨/已出貨/已完成/退貨
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 銷售訂單明細
CREATE TABLE sales_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  product_name TEXT,
  variant_name TEXT,
  qty INTEGER,
  unit_price NUMERIC(10,2),
  subtotal NUMERIC(12,2)
);

-- ============================================================
-- 8. 廣告成本 (Ad Costs)
-- ============================================================
CREATE TABLE ad_costs (
  id BIGSERIAL PRIMARY KEY,
  ad_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9. 營業費用 (Operating Expenses)
-- ============================================================
CREATE TABLE operating_expenses (
  id BIGSERIAL PRIMARY KEY,
  expense_date DATE,
  category TEXT, -- 固定/變動
  description TEXT,
  amount NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Stock Movement Log (for inventory tracking)
-- ============================================================
CREATE TABLE stock_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL, -- 'in' (進貨), 'out' (出貨), 'adjust' (調整)
  qty INTEGER NOT NULL, -- positive for in, negative for out
  reference_type TEXT, -- 'purchase_order', 'sales_order', 'adjustment'
  reference_id BIGINT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
-- For now, simple setup - all authenticated users can access everything
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

-- Policies: allow all for authenticated users
CREATE POLICY "Allow all for authenticated" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON stock_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Also allow anon for development (remove in production)
CREATE POLICY "Allow all for anon" ON products FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON purchase_orders FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON stock_movements FOR ALL TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_name ON products(product_name);
CREATE INDEX idx_products_status ON products(product_status);
CREATE INDEX idx_po_number ON purchase_orders(po_number);
CREATE INDEX idx_po_date ON purchase_orders(order_date);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_date ON stock_movements(created_at);
CREATE INDEX idx_sales_orders_date ON sales_orders(order_date);
CREATE INDEX idx_ad_costs_date ON ad_costs(ad_date);

-- ============================================================
-- Updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER po_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER domestic_logistics_updated_at BEFORE UPDATE ON domestic_logistics FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER consolidated_shipments_updated_at BEFORE UPDATE ON consolidated_shipments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER product_selections_updated_at BEFORE UPDATE ON product_selections FOR EACH ROW EXECUTE FUNCTION update_updated_at();
