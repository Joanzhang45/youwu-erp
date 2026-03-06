-- Youwu ERP Database Schema v2 (no Chinese defaults to avoid encoding issues)

CREATE TABLE product_selections (
  id BIGSERIAL PRIMARY KEY,
  selection_date DATE,
  selection_number TEXT UNIQUE,
  product_name TEXT NOT NULL,
  product_image TEXT,
  cny_rate NUMERIC(6,4) DEFAULT 4.57,
  category TEXT,
  notes TEXT,
  shipping_method TEXT DEFAULT 'sea',
  shipping_rate_per_kg NUMERIC(8,2) DEFAULT 42,
  order_link TEXT,
  status TEXT DEFAULT 'evaluating',
  sales_mode TEXT DEFAULT 'stock',
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

CREATE TABLE product_variants (
  id BIGSERIAL PRIMARY KEY,
  selection_id BIGINT REFERENCES product_selections(id) ON DELETE CASCADE,
  variant_name TEXT,
  variant_image TEXT,
  purchase_price_cny NUMERIC(10,4),
  selling_price_ntd NUMERIC(10,2),
  weight_kg NUMERIC(8,4),
  domestic_shipping_cny NUMERIC(8,4),
  qty INTEGER DEFAULT 0,
  unit_cost_ntd NUMERIC(10,4),
  profit_ntd NUMERIC(10,4),
  margin_pct NUMERIC(6,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE competitor_products (
  id BIGSERIAL PRIMARY KEY,
  selection_id BIGINT REFERENCES product_selections(id) ON DELETE CASCADE,
  competitor_name TEXT,
  competitor_price NUMERIC(10,2),
  competitor_link TEXT,
  notes TEXT
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  product_name TEXT NOT NULL,
  sku TEXT UNIQUE,
  category TEXT,
  variant_name TEXT,
  selection_number TEXT,
  shopee_spec_id TEXT,
  order_link TEXT,
  product_positioning TEXT,
  product_image TEXT,
  notes TEXT,
  selling_price NUMERIC(10,2),
  purchase_price_cny NUMERIC(10,4),
  product_status TEXT DEFAULT 'testing',
  domestic_shipping_thrown NUMERIC(10,4),
  unit_cost_ntd NUMERIC(10,4),
  domestic_shipping_per_unit_cny NUMERIC(10,4),
  initial_order_qty INTEGER,
  domestic_shipping_per_unit_thrown NUMERIC(10,4),
  platform_fee_rate NUMERIC(6,4) DEFAULT 0.145,
  avg_daily_sales NUMERIC(8,4),
  avg_shipping_days NUMERIC(8,2),
  unit_profit NUMERIC(10,4),
  weight_kg NUMERIC(8,4),
  safety_stock INTEGER,
  total_purchased_qty INTEGER DEFAULT 0,
  total_purchase_cost NUMERIC(12,2) DEFAULT 0,
  avg_purchase_price NUMERIC(10,4),
  current_stock_cost NUMERIC(12,2) DEFAULT 0,
  total_sold_qty INTEGER DEFAULT 0,
  total_sales_revenue NUMERIC(12,2) DEFAULT 0,
  gross_margin NUMERIC(6,4),
  realized_profit NUMERIC(12,2) DEFAULT 0,
  total_shipped_qty INTEGER DEFAULT 0,
  shopee_fee_total NUMERIC(12,2) DEFAULT 0,
  net_revenue_subtotal NUMERIC(12,2) DEFAULT 0,
  first_order_date DATE,
  total_order_days INTEGER,
  latest_po_number TEXT,
  stock_qty INTEGER GENERATED ALWAYS AS (total_purchased_qty - total_shipped_qty) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  po_number TEXT UNIQUE NOT NULL,
  purchaser TEXT,
  payment_method TEXT,
  forwarder TEXT,
  forwarder_phone TEXT,
  order_date DATE,
  photo_thumbnail TEXT,
  cny_rate NUMERIC(6,4),
  shipping_rate_per_kg NUMERIC(8,2),
  logistics_status TEXT DEFAULT 'draft',
  total_payment_cny NUMERIC(12,4),
  forwarder_address TEXT,
  notes TEXT,
  total_payment_ntd NUMERIC(12,2),
  payment_status TEXT DEFAULT 'unpaid',
  subtotal_cny NUMERIC(12,4),
  customs_duty NUMERIC(10,2),
  grand_total NUMERIC(12,2),
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

CREATE TABLE domestic_logistics (
  id BIGSERIAL PRIMARY KEY,
  tracking_number TEXT,
  po_number TEXT,
  forwarder TEXT,
  logistics_company TEXT,
  waybill_number TEXT,
  shipping_date DATE,
  expected_arrival DATE,
  actual_arrival DATE,
  status TEXT DEFAULT 'pending',
  total_weight_kg NUMERIC(10,4),
  shipping_cost_cny NUMERIC(10,4),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE consolidated_shipments (
  id BIGSERIAL PRIMARY KEY,
  shipment_number TEXT UNIQUE,
  forwarder TEXT,
  shipping_method TEXT,
  departure_date DATE,
  expected_arrival DATE,
  actual_arrival DATE,
  status TEXT DEFAULT 'pending',
  total_weight_kg NUMERIC(10,4),
  shipping_cost_ntd NUMERIC(12,2),
  customs_duty NUMERIC(10,2),
  total_cost_ntd NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE receiving_records (
  id BIGSERIAL PRIMARY KEY,
  receiving_number TEXT UNIQUE,
  shipment_number TEXT,
  receiving_date DATE,
  receiver TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE receiving_record_items (
  id BIGSERIAL PRIMARY KEY,
  receiving_id BIGINT REFERENCES receiving_records(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  product_name TEXT,
  variant_name TEXT,
  expected_qty INTEGER,
  actual_qty INTEGER,
  discrepancy INTEGER GENERATED ALWAYS AS (actual_qty - expected_qty) STORED,
  condition TEXT DEFAULT 'good',
  notes TEXT
);

CREATE TABLE sales_orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT UNIQUE,
  order_date DATE,
  buyer_name TEXT,
  order_amount NUMERIC(12,2),
  transaction_fee NUMERIC(10,2),
  free_shipping_subsidy NUMERIC(10,2),
  extended_prep_fee NUMERIC(10,2),
  payment_processing_fee NUMERIC(10,2),
  seller_coupon NUMERIC(10,2),
  platform_coupon NUMERIC(10,2),
  net_revenue NUMERIC(12,2),
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE ad_costs (
  id BIGSERIAL PRIMARY KEY,
  ad_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE operating_expenses (
  id BIGSERIAL PRIMARY KEY,
  expense_date DATE,
  category TEXT,
  description TEXT,
  amount NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stock_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL,
  qty INTEGER NOT NULL,
  reference_type TEXT,
  reference_id BIGINT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_authenticated_products" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_authenticated_po" ON purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_authenticated_sm" ON stock_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_anon_products" ON products FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_anon_po" ON purchase_orders FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_anon_sm" ON stock_movements FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_name ON products(product_name);
CREATE INDEX idx_products_status ON products(product_status);
CREATE INDEX idx_po_number ON purchase_orders(po_number);
CREATE INDEX idx_po_date ON purchase_orders(order_date);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_date ON stock_movements(created_at);
CREATE INDEX idx_sales_orders_date ON sales_orders(order_date);
CREATE INDEX idx_ad_costs_date ON ad_costs(ad_date);

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
