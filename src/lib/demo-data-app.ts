// M2 新任務導向流程（/today /receive /stock）展示模式資料。
// M4 追加 /more /insights 用的月度損益展示資料。
// 新檔、不改動 demo-data.ts；商品資料直接重用既有 DEMO_PRODUCTS，避免重複維護兩份假資料。
import type { ConsolidatedShipment, ConsolidatedShipmentItem, MonthlyProfitability } from "./database.types";
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

// 近 6 個月月度損益展示資料（M4，對應 v_monthly_profitability）。
// month 用真實「現在」往回推算，作品集展示才不會日期一眼看出是舊資料；
// 金額本身仍沿用既有 DEMO_KPI 手法——刻意避開真實營運數字量級、挑好看整數。
// index 0 = 本月（部分月，天數尚未跑完所以比上月低是合理現象）。
// Info-3 修復（tester 2026-07-12）：舊寫法用 .toISOString().slice(0,10) 把「本地日期」轉
// 成 UTC 字串——台北是 UTC+8，只要瀏覽器本地時間落在 00:00~07:59，換算回 UTC 會退到「前一
// 天」，剛好跨月時整個月份就退一格（例：本地 7/1 03:00 → UTC 6/30 19:00 → 誤判成 6 月）。
// 這正是「demo 模式本月損益全 $0」的根因：DEMO_MONTHLY_PROFITABILITY[0] 算出來變成「上個月」
// 而非「本月」，跟 /insights 用本地年月比對的 thisMonthStr 對不上，find() 找不到列就落到全 0。
// 改用本地年/月/日組字串，不經過 UTC 轉換，跟 insights/page.tsx 的 pad2()/toDateStr() 用同一
// 種算法（本地 getFullYear/getMonth），才不會兩邊各用一套時區邏輯互相對不上。
function demoMonthStart(monthsAgo: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export const DEMO_MONTHLY_PROFITABILITY: MonthlyProfitability[] = [
  { month: demoMonthStart(0), order_count: 61, total_revenue: 46000, total_net_revenue: 42800, total_cogs: 19200, gross_profit: 23600, total_ad_cost: 5900, total_expenses: 2900, net_profit: 14800 },
  { month: demoMonthStart(1), order_count: 78, total_revenue: 44300, total_net_revenue: 41200, total_cogs: 18500, gross_profit: 22700, total_ad_cost: 3600, total_expenses: 2300, net_profit: 16800 },
  { month: demoMonthStart(2), order_count: 71, total_revenue: 40600, total_net_revenue: 37800, total_cogs: 17000, gross_profit: 20800, total_ad_cost: 3400, total_expenses: 2200, net_profit: 15200 },
  { month: demoMonthStart(3), order_count: 63, total_revenue: 35700, total_net_revenue: 33200, total_cogs: 15000, gross_profit: 18200, total_ad_cost: 3100, total_expenses: 2000, net_profit: 13100 },
  { month: demoMonthStart(4), order_count: 55, total_revenue: 31700, total_net_revenue: 29500, total_cogs: 13300, gross_profit: 16200, total_ad_cost: 2800, total_expenses: 1900, net_profit: 11500 },
  { month: demoMonthStart(5), order_count: 48, total_revenue: 27900, total_net_revenue: 26000, total_cogs: 11700, gross_profit: 14300, total_ad_cost: 2600, total_expenses: 1800, net_profit: 9900 },
];

export const DEMO_KPI = {
  monthRevenue: DEMO_MONTHLY_PROFITABILITY[0].total_net_revenue,
  monthOrders: DEMO_MONTHLY_PROFITABILITY[0].order_count,
  monthGrossProfit: DEMO_MONTHLY_PROFITABILITY[0].gross_profit,
  monthNetProfit: DEMO_MONTHLY_PROFITABILITY[0].net_profit,
  outOfStock: 2,
  lowStock: 5,
};
