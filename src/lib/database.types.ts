// 前端用的資料型別。欄位一律來自 database.generated.ts（scripts/dump_schema.py 依線上資料庫產生），
// 這裡只取好記的名字，不再手寫欄位（第二次健檢 #26：手寫版和資料庫已經對不上，例如舊的
// StockMovement 欄位根本不存在）。改資料表 → 寫 migration → 套用 → 重跑 dump_schema.py。
import type { Tables, Views } from "./database.generated";

export type { Tables, Views };

// 商品頁都讀 v_products_with_stock（products 全部欄位＋帳本加總出來的 stock_qty），
// 欄位的 null 與否照資料表本身；stock_qty 由 view 以 COALESCE 算出，不會是 null。
export type Product = Tables["products"] & { stock_qty: number };

export type ProductSelection = Tables["product_selections"];
export type ProductVariant = Tables["product_variants"];
export type CompetitorProduct = Tables["competitor_products"];

export type PurchaseOrder = Tables["purchase_orders"];
export type PurchaseOrderItem = Tables["purchase_order_items"];
export type DomesticLogistics = Tables["domestic_logistics"];
export type DomesticLogisticsItem = Tables["domestic_logistics_items"];
export type ConsolidatedShipment = Tables["consolidated_shipments"];
export type ConsolidatedShipmentItem = Tables["consolidated_shipment_items"];
export type ReceivingRecord = Tables["receiving_records"];
export type ReceivingRecordItem = Tables["receiving_record_items"];
export type InventoryLedger = Tables["inventory_ledger"];

export type SalesOrder = Tables["sales_orders"];
export type SalesOrderItem = Tables["sales_order_items"];
export type AdCost = Tables["ad_costs"];
export type OperatingExpense = Tables["operating_expenses"];

// v_monthly_profitability.month 是 date_trunc('month', ...)::date，Postgrest 回傳 "YYYY-MM-01"。
// 檢視的欄位資料庫不記 NOT NULL；這個 view 每個數字欄都 COALESCE 過，所以這裡標成必有值。
export type MonthlyProfitability = { [K in keyof Views["v_monthly_profitability"]]: NonNullable<Views["v_monthly_profitability"][K]> };
