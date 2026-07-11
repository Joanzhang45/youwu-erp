// M2 新任務導向流程（/today /receive /stock）展示模式資料。
// 新檔、不改動 demo-data.ts；商品資料直接重用既有 DEMO_PRODUCTS，避免重複維護兩份假資料。
import type { ConsolidatedShipment, ConsolidatedShipmentItem } from "./database.types";
import { DEMO_PRODUCTS } from "./demo-data";

export type DemoShipmentItem = ConsolidatedShipmentItem & {
  product_image: string | null;
  purchase_price_cny: number | null;
};

export const DEMO_SHIPMENTS: ConsolidatedShipment[] = [
  {
    id: 9001,
    shipment_number: "SH-20260710-002",
    forwarder: "台盈物流",
    shipping_method: "海運",
    departure_date: "2026-07-05",
    expected_arrival: "2026-07-12",
    actual_arrival: "2026-07-12",
    status: "已到達",
    total_weight_kg: 42.5,
    shipping_cost_ntd: 3800,
    customs_duty: 0,
    total_cost_ntd: 3800,
    notes: null,
    created_at: "2026-07-05T02:00:00Z",
    updated_at: "2026-07-12T01:00:00Z",
  },
  {
    id: 9002,
    shipment_number: "SH-20260711-001",
    forwarder: "台盈物流",
    shipping_method: "空運",
    departure_date: "2026-07-11",
    expected_arrival: "2026-07-15",
    actual_arrival: null,
    status: "運送中",
    total_weight_kg: 18.2,
    shipping_cost_ntd: 2600,
    customs_duty: 0,
    total_cost_ntd: 2600,
    notes: null,
    created_at: "2026-07-11T03:00:00Z",
    updated_at: "2026-07-11T03:00:00Z",
  },
];

// 已到達的 SH-20260710-002 對應 3 個品項（借用 DEMO_PRODUCTS id 1/3/7）
export const DEMO_SHIPMENT_ITEMS: Record<number, DemoShipmentItem[]> = {
  9001: [
    {
      id: 90011,
      shipment_id: 9001,
      po_number: "PO-20260628-003",
      product_id: 1,
      product_name: DEMO_PRODUCTS[0].product_name,
      variant_name: DEMO_PRODUCTS[0].variant_name,
      qty: 60,
      weight_kg: DEMO_PRODUCTS[0].weight_kg,
      notes: null,
      product_image: DEMO_PRODUCTS[0].product_image,
      purchase_price_cny: DEMO_PRODUCTS[0].purchase_price_cny,
    },
    {
      id: 90012,
      shipment_id: 9001,
      po_number: "PO-20260628-003",
      product_id: 3,
      product_name: DEMO_PRODUCTS[2].product_name,
      variant_name: DEMO_PRODUCTS[2].variant_name,
      qty: 100,
      weight_kg: DEMO_PRODUCTS[2].weight_kg,
      notes: null,
      product_image: DEMO_PRODUCTS[2].product_image,
      purchase_price_cny: DEMO_PRODUCTS[2].purchase_price_cny,
    },
    {
      id: 90013,
      shipment_id: 9001,
      po_number: "PO-20260628-003",
      product_id: 7,
      product_name: DEMO_PRODUCTS[6].product_name,
      variant_name: DEMO_PRODUCTS[6].variant_name,
      qty: 40,
      weight_kg: DEMO_PRODUCTS[6].weight_kg,
      notes: null,
      product_image: DEMO_PRODUCTS[6].product_image,
      purchase_price_cny: DEMO_PRODUCTS[6].purchase_price_cny,
    },
  ],
  9002: [],
};

export const DEMO_RECENT_ACTIVITY = [
  { id: 1, text: "矽藻土杯墊（圓形-大理石紋）入庫 +60", time: "今天 09:12" },
  { id: 2, text: "壁掛式置物架（白色）出庫 -3", time: "昨天 18:40" },
  { id: 3, text: "SH-20260706-004 完成點收（14 項）", time: "2026-07-09" },
];

export const DEMO_LAST_STOCKTAKE_DAYS = 23;

export const DEMO_KPI = {
  monthRevenue: 42800,
  monthOrders: 61,
  outOfStock: 2,
  lowStock: 5,
};
