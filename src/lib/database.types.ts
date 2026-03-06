// ============================================================
// 商品相關
// ============================================================

export interface Product {
  id: number
  product_name: string
  sku: string | null
  category: string | null
  variant_name: string | null
  selection_number: string | null
  shopee_spec_id: string | null
  order_link: string | null
  product_positioning: string | null
  product_image: string | null
  notes: string | null
  selling_price: number | null
  purchase_price_cny: number | null
  product_status: string | null
  domestic_shipping_thrown: number | null
  unit_cost_ntd: number | null
  domestic_shipping_per_unit_cny: number | null
  initial_order_qty: number | null
  domestic_shipping_per_unit_thrown: number | null
  platform_fee_rate: number | null
  avg_daily_sales: number | null
  avg_shipping_days: number | null
  unit_profit: number | null
  weight_kg: number | null
  safety_stock: number | null
  total_purchased_qty: number
  total_purchase_cost: number
  avg_purchase_price: number | null
  current_stock_cost: number
  total_sold_qty: number
  total_sales_revenue: number
  gross_margin: number | null
  realized_profit: number
  total_shipped_qty: number
  shopee_fee_total: number
  net_revenue_subtotal: number
  first_order_date: string | null
  total_order_days: number | null
  latest_po_number: string | null
  stock_qty: number
  created_at: string
  updated_at: string
}

export interface ProductSelection {
  id: number
  selection_date: string | null
  selection_number: string | null
  product_name: string | null
  product_image: string | null
  cny_rate: number | null
  category: string | null
  notes: string | null
  shipping_method: string | null
  shipping_rate_per_kg: number | null
  order_link: string | null
  status: string | null
  sales_mode: string | null
  domestic_shipping_cny: number | null
  total_purchase_cost_ntd: number | null
  competitor_max_price: number | null
  competitor_min_price: number | null
  total_qty: number | null
  total_weight_kg: number | null
  order_amount_cny: number | null
  created_at: string
  updated_at: string
}

export interface ProductVariant {
  id: number
  selection_id: number | null
  variant_name: string | null
  variant_image: string | null
  purchase_price_cny: number | null
  selling_price_ntd: number | null
  weight_kg: number | null
  domestic_shipping_cny: number | null
  qty: number | null
  unit_cost_ntd: number | null
  profit_ntd: number | null
  margin_pct: number | null
  created_at: string
}

export interface CompetitorProduct {
  id: number
  selection_id: number | null
  competitor_name: string | null
  competitor_price: number | null
  competitor_link: string | null
  notes: string | null
}

// ============================================================
// 採購與物流
// ============================================================

export interface PurchaseOrder {
  id: number
  po_number: string
  purchaser: string | null
  payment_method: string | null
  forwarder: string | null
  forwarder_phone: string | null
  order_date: string | null
  photo_thumbnail: string | null
  cny_rate: number | null
  shipping_rate_per_kg: number | null
  logistics_status: string | null
  total_payment_cny: number | null
  forwarder_address: string | null
  notes: string | null
  total_payment_ntd: number | null
  payment_status: string | null
  subtotal_cny: number | null
  customs_duty: number | null
  grand_total: number | null
  status_draft: boolean | null
  status_confirmed: boolean | null
  status_ordered: boolean | null
  status_paid: boolean | null
  status_shipping: boolean | null
  status_warehouse_received: boolean | null
  status_warehouse_stored: boolean | null
  status_return_shipping: boolean | null
  status_received: boolean | null
  status_cancelled: boolean | null
  status_abnormal: number | null
  created_at: string
  updated_at: string
}

export interface PurchaseOrderItem {
  id: number
  po_id: number
  product_id: number | null
  product_name: string | null
  variant_name: string | null
  product_image: string | null
  qty: number | null
  unit_price_cny: number | null
  subtotal_cny: number | null
  weight_kg: number | null
  domestic_shipping_cny: number | null
  notes: string | null
  created_at: string
}

export interface DomesticLogistics {
  id: number
  tracking_number: string | null
  po_number: string | null
  forwarder: string | null
  logistics_company: string | null
  waybill_number: string | null
  shipping_date: string | null
  expected_arrival: string | null
  actual_arrival: string | null
  status: string | null
  total_weight_kg: number | null
  shipping_cost_cny: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface DomesticLogisticsItem {
  id: number
  logistics_id: number
  product_id: number | null
  product_name: string | null
  variant_name: string | null
  qty: number | null
  weight_kg: number | null
  notes: string | null
}

export interface ConsolidatedShipment {
  id: number
  shipment_number: string | null
  forwarder: string | null
  shipping_method: string | null
  departure_date: string | null
  expected_arrival: string | null
  actual_arrival: string | null
  status: string | null
  total_weight_kg: number | null
  shipping_cost_ntd: number | null
  customs_duty: number | null
  total_cost_ntd: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ConsolidatedShipmentItem {
  id: number
  shipment_id: number
  po_number: string | null
  product_id: number | null
  product_name: string | null
  variant_name: string | null
  qty: number | null
  weight_kg: number | null
  notes: string | null
}

export interface ReceivingRecord {
  id: number
  receiving_number: string | null
  shipment_number: string | null
  receiving_date: string | null
  receiver: string | null
  notes: string | null
  created_at: string
}

export interface ReceivingRecordItem {
  id: number
  receiving_id: number
  product_id: number | null
  product_name: string | null
  variant_name: string | null
  expected_qty: number | null
  actual_qty: number | null
  discrepancy: number | null
  condition: string | null
  notes: string | null
}

// ============================================================
// 庫存
// ============================================================

export interface StockMovement {
  id: number
  product_id: number
  movement_type: 'in' | 'out' | 'adjust'
  qty: number
  reference_type: string | null
  reference_id: number | null
  notes: string | null
  created_by: string | null
  created_at: string
}

// ============================================================
// 銷售與財務
// ============================================================

export interface SalesOrder {
  id: number
  order_number: string | null
  order_date: string | null
  buyer_name: string | null
  order_amount: number | null
  transaction_fee: number | null
  free_shipping_subsidy: number | null
  extended_prep_fee: number | null
  payment_processing_fee: number | null
  seller_coupon: number | null
  platform_coupon: number | null
  net_revenue: number | null
  status: string | null
  notes: string | null
  created_at: string
}

export interface SalesOrderItem {
  id: number
  order_id: number
  product_id: number | null
  product_name: string | null
  variant_name: string | null
  qty: number | null
  unit_price: number | null
  subtotal: number | null
}

export interface AdCost {
  id: number
  ad_date: string | null
  amount: number | null
  description: string | null
  created_at: string
}

export interface OperatingExpense {
  id: number
  expense_date: string | null
  category: string | null
  description: string | null
  amount: number | null
  notes: string | null
  created_at: string
}
