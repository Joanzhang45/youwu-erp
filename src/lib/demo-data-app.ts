// M2 新任務導向流程（/today /receive /stock）展示模式資料。
// M4 追加 /more /insights 用的月度損益展示資料。
// M4 第二批追加 /inbound 進貨鏈時間軸展示資料（採購單／物流／選品候選）。
// 新檔、不改動 demo-data.ts；商品資料直接重用既有 DEMO_PRODUCTS，避免重複維護兩份假資料。
import type {
  AdCost,
  ConsolidatedShipment,
  ConsolidatedShipmentItem,
  DomesticLogistics,
  MonthlyProfitability,
  OperatingExpense,
  ProductSelection,
  PurchaseOrder,
  PurchaseOrderItem,
  SalesOrder,
  SalesOrderItem,
} from "./database.types";
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
  // 9002（運送中，尚未到貨）掛 2 個品項，po_number 對到下面 DEMO_PURCHASE_ORDERS 的
  // PO-20260710-001，讓 /inbound 詳情頁能示範「集運進行中、到貨與點收都還沒發生」的節點。
  9002: [
    {
      id: 90021,
      shipment_id: 9002,
      po_number: "PO-20260710-001",
      product_id: 5,
      product_name: DEMO_PRODUCTS[4].product_name,
      variant_name: DEMO_PRODUCTS[4].variant_name,
      qty: 30,
      weight_kg: DEMO_PRODUCTS[4].weight_kg,
      notes: null,
      product_image: DEMO_PRODUCTS[4].product_image,
      purchase_price_cny: DEMO_PRODUCTS[4].purchase_price_cny,
    },
    {
      id: 90022,
      shipment_id: 9002,
      po_number: "PO-20260710-001",
      product_id: 6,
      product_name: DEMO_PRODUCTS[5].product_name,
      variant_name: DEMO_PRODUCTS[5].variant_name,
      qty: 20,
      weight_kg: DEMO_PRODUCTS[5].weight_kg,
      notes: null,
      product_image: DEMO_PRODUCTS[5].product_image,
      purchase_price_cny: DEMO_PRODUCTS[5].purchase_price_cny,
    },
  ],
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

// ============================================================
// /inbound 進貨鏈時間軸展示資料（M4 第二批）
// 用「現在」往回推算日期，避免展示資料日期一眼看出是舊資料（同 demoMonthStart 手法）。
// 三張「進行中」採購單刻意涵蓋時間軸不同節點，示範完整功能：
//   PO-20260711-004：剛下單，status_draft 仍 true → 示範節點 1「標記已下單」CTA
//   PO-20260710-001：物流已入庫、集運中（掛到 DEMO_SHIPMENT_ITEMS[9002]，狀態運送中）
//   PO-20260628-003：物流／集運皆完成、shipment 9001 已到達但尚未點收 → 示範節點 5
//                    「前往點收」CTA，直接可以打進已存在的 /receive?shipment_id=9001 demo 流程
// 另一張 PO-20260315-002 status_received=true，示範「歷史」摺疊清單裡的完整單。
// ============================================================

function demoDateOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const DEMO_PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: 8001,
    po_number: "PO-20260711-004",
    purchaser: "彣錩",
    payment_method: "支付寶",
    forwarder: null,
    forwarder_phone: null,
    order_date: demoDateOffset(1),
    photo_thumbnail: null,
    cny_rate: 4.5,
    shipping_rate_per_kg: null,
    logistics_status: null,
    total_payment_cny: 890,
    forwarder_address: null,
    notes: null,
    total_payment_ntd: 4005,
    payment_status: "未付款",
    subtotal_cny: 890,
    customs_duty: null,
    grand_total: 4005,
    status_draft: true,
    status_confirmed: false,
    status_ordered: false,
    status_paid: false,
    status_shipping: false,
    status_warehouse_received: false,
    status_warehouse_stored: false,
    status_return_shipping: false,
    status_received: false,
    status_cancelled: false,
    status_abnormal: 0,
    created_at: `${demoDateOffset(1)}T02:00:00Z`,
    updated_at: `${demoDateOffset(1)}T02:00:00Z`,
  },
  {
    id: 8002,
    po_number: "PO-20260710-001",
    purchaser: "張瓊安",
    payment_method: "信用卡",
    forwarder: "台盈物流",
    forwarder_phone: null,
    order_date: demoDateOffset(2),
    photo_thumbnail: null,
    cny_rate: 4.5,
    shipping_rate_per_kg: 65,
    logistics_status: null,
    total_payment_cny: 2400,
    forwarder_address: null,
    notes: null,
    total_payment_ntd: 10800,
    payment_status: "已付款",
    subtotal_cny: 2400,
    customs_duty: null,
    grand_total: 10800,
    status_draft: false,
    status_confirmed: true,
    status_ordered: true,
    status_paid: true,
    status_shipping: false,
    status_warehouse_received: false,
    status_warehouse_stored: false,
    status_return_shipping: false,
    status_received: false,
    status_cancelled: false,
    status_abnormal: 0,
    created_at: `${demoDateOffset(2)}T02:00:00Z`,
    updated_at: `${demoDateOffset(1)}T03:00:00Z`,
  },
  {
    id: 8003,
    po_number: "PO-20260628-003",
    purchaser: "張瓊安",
    payment_method: "信用卡",
    forwarder: "台盈物流",
    forwarder_phone: null,
    order_date: demoDateOffset(14),
    photo_thumbnail: null,
    cny_rate: 4.45,
    shipping_rate_per_kg: 65,
    logistics_status: null,
    total_payment_cny: 3560,
    forwarder_address: null,
    notes: null,
    total_payment_ntd: 15842,
    payment_status: "已付款",
    subtotal_cny: 3560,
    customs_duty: 0,
    grand_total: 15842,
    status_draft: false,
    status_confirmed: true,
    status_ordered: true,
    status_paid: true,
    status_shipping: true,
    status_warehouse_received: true,
    status_warehouse_stored: true,
    status_return_shipping: false,
    status_received: false,
    status_cancelled: false,
    status_abnormal: 0,
    created_at: `${demoDateOffset(14)}T02:00:00Z`,
    updated_at: demoDateOffset(0) + "T01:00:00Z",
  },
  {
    id: 8004,
    po_number: "PO-20260315-002",
    purchaser: "張瓊安",
    payment_method: "匯款",
    forwarder: "超級派送員",
    forwarder_phone: null,
    order_date: demoDateOffset(119),
    photo_thumbnail: null,
    cny_rate: 4.5,
    shipping_rate_per_kg: 60,
    logistics_status: null,
    total_payment_cny: 1800,
    forwarder_address: null,
    notes: null,
    total_payment_ntd: 8200,
    payment_status: "已付款",
    subtotal_cny: 1800,
    customs_duty: 0,
    grand_total: 8200,
    status_draft: false,
    status_confirmed: true,
    status_ordered: true,
    status_paid: true,
    status_shipping: true,
    status_warehouse_received: true,
    status_warehouse_stored: true,
    status_return_shipping: true,
    status_received: true,
    status_cancelled: false,
    status_abnormal: 0,
    created_at: `${demoDateOffset(119)}T02:00:00Z`,
    updated_at: `${demoDateOffset(109)}T01:00:00Z`,
  },
];

export const DEMO_PURCHASE_ORDER_ITEMS: Record<number, PurchaseOrderItem[]> = {
  8001: [
    {
      id: 80011,
      po_id: 8001,
      product_id: 5,
      product_name: DEMO_PRODUCTS[4].product_name,
      variant_name: DEMO_PRODUCTS[4].variant_name,
      product_image: DEMO_PRODUCTS[4].product_image,
      qty: 30,
      unit_price_cny: DEMO_PRODUCTS[4].purchase_price_cny,
      subtotal_cny: (DEMO_PRODUCTS[4].purchase_price_cny || 0) * 30,
      weight_kg: DEMO_PRODUCTS[4].weight_kg,
      domestic_shipping_cny: null,
      notes: null,
      created_at: `${demoDateOffset(1)}T02:00:00Z`,
    },
  ],
  8002: [
    {
      id: 80021,
      po_id: 8002,
      product_id: 5,
      product_name: DEMO_PRODUCTS[4].product_name,
      variant_name: DEMO_PRODUCTS[4].variant_name,
      product_image: DEMO_PRODUCTS[4].product_image,
      qty: 30,
      unit_price_cny: DEMO_PRODUCTS[4].purchase_price_cny,
      subtotal_cny: (DEMO_PRODUCTS[4].purchase_price_cny || 0) * 30,
      weight_kg: DEMO_PRODUCTS[4].weight_kg,
      domestic_shipping_cny: null,
      notes: null,
      created_at: `${demoDateOffset(2)}T02:00:00Z`,
    },
    {
      id: 80022,
      po_id: 8002,
      product_id: 6,
      product_name: DEMO_PRODUCTS[5].product_name,
      variant_name: DEMO_PRODUCTS[5].variant_name,
      product_image: DEMO_PRODUCTS[5].product_image,
      qty: 20,
      unit_price_cny: DEMO_PRODUCTS[5].purchase_price_cny,
      subtotal_cny: (DEMO_PRODUCTS[5].purchase_price_cny || 0) * 20,
      weight_kg: DEMO_PRODUCTS[5].weight_kg,
      domestic_shipping_cny: null,
      notes: null,
      created_at: `${demoDateOffset(2)}T02:00:00Z`,
    },
  ],
  8003: [
    {
      id: 80031,
      po_id: 8003,
      product_id: 1,
      product_name: DEMO_PRODUCTS[0].product_name,
      variant_name: DEMO_PRODUCTS[0].variant_name,
      product_image: DEMO_PRODUCTS[0].product_image,
      qty: 60,
      unit_price_cny: DEMO_PRODUCTS[0].purchase_price_cny,
      subtotal_cny: (DEMO_PRODUCTS[0].purchase_price_cny || 0) * 60,
      weight_kg: DEMO_PRODUCTS[0].weight_kg,
      domestic_shipping_cny: null,
      notes: null,
      created_at: `${demoDateOffset(14)}T02:00:00Z`,
    },
    {
      id: 80032,
      po_id: 8003,
      product_id: 3,
      product_name: DEMO_PRODUCTS[2].product_name,
      variant_name: DEMO_PRODUCTS[2].variant_name,
      product_image: DEMO_PRODUCTS[2].product_image,
      qty: 100,
      unit_price_cny: DEMO_PRODUCTS[2].purchase_price_cny,
      subtotal_cny: (DEMO_PRODUCTS[2].purchase_price_cny || 0) * 100,
      weight_kg: DEMO_PRODUCTS[2].weight_kg,
      domestic_shipping_cny: null,
      notes: null,
      created_at: `${demoDateOffset(14)}T02:00:00Z`,
    },
    {
      id: 80033,
      po_id: 8003,
      product_id: 7,
      product_name: DEMO_PRODUCTS[6].product_name,
      variant_name: DEMO_PRODUCTS[6].variant_name,
      product_image: DEMO_PRODUCTS[6].product_image,
      qty: 40,
      unit_price_cny: DEMO_PRODUCTS[6].purchase_price_cny,
      subtotal_cny: (DEMO_PRODUCTS[6].purchase_price_cny || 0) * 40,
      weight_kg: DEMO_PRODUCTS[6].weight_kg,
      domestic_shipping_cny: null,
      notes: null,
      created_at: `${demoDateOffset(14)}T02:00:00Z`,
    },
  ],
  8004: [
    {
      id: 80041,
      po_id: 8004,
      product_id: 8,
      product_name: DEMO_PRODUCTS[7].product_name,
      variant_name: DEMO_PRODUCTS[7].variant_name,
      product_image: DEMO_PRODUCTS[7].product_image,
      qty: 40,
      unit_price_cny: DEMO_PRODUCTS[7].purchase_price_cny,
      subtotal_cny: (DEMO_PRODUCTS[7].purchase_price_cny || 0) * 40,
      weight_kg: DEMO_PRODUCTS[7].weight_kg,
      domestic_shipping_cny: null,
      notes: null,
      created_at: `${demoDateOffset(119)}T02:00:00Z`,
    },
  ],
};

// keyed by po_number（沿用 domestic_logistics 真實 schema 的文字比對關聯）
export const DEMO_DOMESTIC_LOGISTICS: Record<string, DomesticLogistics[]> = {
  "PO-20260710-001": [
    {
      id: 90101,
      tracking_number: "YT8801234567890",
      po_number: "PO-20260710-001",
      forwarder: "台盈物流",
      logistics_company: "圆通速递(YTO)",
      waybill_number: "IN-20260711-002",
      shipping_date: demoDateOffset(2),
      expected_arrival: null,
      actual_arrival: demoDateOffset(1),
      status: "已入庫",
      total_weight_kg: 5.4,
      shipping_cost_cny: null,
      notes: null,
      created_at: `${demoDateOffset(2)}T02:00:00Z`,
      updated_at: `${demoDateOffset(1)}T02:00:00Z`,
    },
  ],
  "PO-20260628-003": [
    {
      id: 90102,
      tracking_number: "YT7799887766554",
      po_number: "PO-20260628-003",
      forwarder: "台盈物流",
      logistics_company: "中通快递(ZTO)",
      waybill_number: "IN-20260701-005",
      shipping_date: demoDateOffset(14),
      expected_arrival: null,
      actual_arrival: demoDateOffset(11),
      status: "已入庫",
      total_weight_kg: 12.8,
      shipping_cost_cny: null,
      notes: null,
      created_at: `${demoDateOffset(14)}T02:00:00Z`,
      updated_at: `${demoDateOffset(11)}T02:00:00Z`,
    },
  ],
};

// ============================================================
// 選品候選（product_selections，/inbound「選品候選」入口區）
// 狀態沿用真實 live DB 目前實際在用的三種值（測品／考慮中／不進貨，2026-07-12 查證），
// 另加「已通過」示範一筆已通過待轉採購的候選，讓篩選 pill 看起來完整。
// ============================================================
export const DEMO_PRODUCT_SELECTIONS: ProductSelection[] = [
  {
    id: 7001,
    selection_date: demoDateOffset(3),
    selection_number: "SEL-20260709-001",
    product_name: "編織收納籃三件組",
    product_image: null,
    cny_rate: 4.5,
    category: "收納好物",
    notes: null,
    shipping_method: "海運",
    shipping_rate_per_kg: 65,
    order_link: null,
    status: "考慮中",
    sales_mode: "一般販售",
    domestic_shipping_cny: 3.5,
    total_purchase_cost_ntd: 2100,
    competitor_max_price: 599,
    competitor_min_price: 399,
    total_qty: 30,
    total_weight_kg: 18,
    order_amount_cny: 420,
    created_at: `${demoDateOffset(3)}T02:00:00Z`,
    updated_at: `${demoDateOffset(3)}T02:00:00Z`,
  },
  {
    id: 7002,
    selection_date: demoDateOffset(6),
    selection_number: "SEL-20260706-004",
    product_name: "陶瓷香氛擴香石",
    product_image: null,
    cny_rate: 4.5,
    category: "布置小物",
    notes: "測品中，等香氣測試結果",
    shipping_method: "空運",
    shipping_rate_per_kg: 120,
    order_link: null,
    status: "測品",
    sales_mode: "一般販售",
    domestic_shipping_cny: 1.2,
    total_purchase_cost_ntd: 850,
    competitor_max_price: 299,
    competitor_min_price: 199,
    total_qty: 10,
    total_weight_kg: 3.5,
    order_amount_cny: 95,
    created_at: `${demoDateOffset(6)}T02:00:00Z`,
    updated_at: `${demoDateOffset(6)}T02:00:00Z`,
  },
  {
    id: 7003,
    selection_date: demoDateOffset(9),
    selection_number: "SEL-20260703-002",
    product_name: "折疊式曬衣架",
    product_image: null,
    cny_rate: 4.5,
    category: "收納好物",
    notes: null,
    shipping_method: "海運",
    shipping_rate_per_kg: 65,
    order_link: null,
    status: "已通過",
    sales_mode: "一般販售",
    domestic_shipping_cny: 8,
    total_purchase_cost_ntd: 4200,
    competitor_max_price: 899,
    competitor_min_price: 599,
    total_qty: 20,
    total_weight_kg: 40,
    order_amount_cny: 900,
    created_at: `${demoDateOffset(9)}T02:00:00Z`,
    updated_at: `${demoDateOffset(4)}T02:00:00Z`,
  },
  {
    id: 7004,
    selection_date: demoDateOffset(20),
    selection_number: "SEL-20260622-003",
    product_name: "仿藤編收納盒",
    product_image: null,
    cny_rate: 4.5,
    category: "收納好物",
    notes: "競品價格太低，毛利不夠",
    shipping_method: "海運",
    shipping_rate_per_kg: 65,
    order_link: null,
    status: "不進貨",
    sales_mode: "一般販售",
    domestic_shipping_cny: 4,
    total_purchase_cost_ntd: 1600,
    competitor_max_price: 199,
    competitor_min_price: 129,
    total_qty: 30,
    total_weight_kg: 15,
    order_amount_cny: 260,
    created_at: `${demoDateOffset(20)}T02:00:00Z`,
    updated_at: `${demoDateOffset(15)}T02:00:00Z`,
  },
];

// ============================================================
// /catalog /sales /spend 展示模式資料（M4 第三批）。
// 訂單/費用金額同樣刻意挑跟 DEMO_MONTHLY_PROFITABILITY 同量級的好看整數，
// 不套用真實營運數字（沿用 DEMO_DASHBOARD_STATS 頭的既有原則）。
// ============================================================

// 蝦皮商品對應工具區展示資料：2 筆未對應組合（呼應 PRD §2.3「208 組合僅 2 筆未對應」現況）
export const DEMO_UNMAPPED_ITEMS = [
  { product_name: "有物🧺北歐風收納籃 現貨", variant_name: "淺灰-M", count: 3 },
  { product_name: "有物🧺矽藻土杯墊 隔日出貨", variant_name: "六角-粉色", count: 1 },
];
export const DEMO_MAPPED_COUNT = 206;

export const DEMO_SALES_ORDERS: SalesOrder[] = [
  { id: 5001, order_number: "2607120001", order_date: demoDateOffset(0), buyer_name: "l***3", order_amount: 1580, transaction_fee: -47, free_shipping_subsidy: 0, extended_prep_fee: -30, payment_processing_fee: -32, seller_coupon: 0, platform_coupon: -50, net_revenue: 1421, status: "待出貨", notes: null, created_at: `${demoDateOffset(0)}T03:00:00Z` },
  { id: 5002, order_number: "2607110008", order_date: demoDateOffset(1), buyer_name: "c***h", order_amount: 890, transaction_fee: -27, free_shipping_subsidy: 0, extended_prep_fee: -18, payment_processing_fee: -18, seller_coupon: 0, platform_coupon: 0, net_revenue: 827, status: "已完成", notes: null, created_at: `${demoDateOffset(1)}T05:00:00Z` },
  { id: 5003, order_number: "2607100015", order_date: demoDateOffset(2), buyer_name: "w***9", order_amount: 2360, transaction_fee: -71, free_shipping_subsidy: 0, extended_prep_fee: -47, payment_processing_fee: -47, seller_coupon: -100, platform_coupon: 0, net_revenue: 2095, status: "已完成", notes: null, created_at: `${demoDateOffset(2)}T07:00:00Z` },
  { id: 5004, order_number: "2607090003", order_date: demoDateOffset(3), buyer_name: "s***2", order_amount: 599, transaction_fee: -18, free_shipping_subsidy: 0, extended_prep_fee: -12, payment_processing_fee: -12, seller_coupon: 0, platform_coupon: 0, net_revenue: 557, status: "已完成", notes: null, created_at: `${demoDateOffset(3)}T02:00:00Z` },
  { id: 5005, order_number: "2607080011", order_date: demoDateOffset(4), buyer_name: "t***a", order_amount: 138, transaction_fee: -4, free_shipping_subsidy: 0, extended_prep_fee: -3, payment_processing_fee: -3, seller_coupon: 0, platform_coupon: 0, net_revenue: 128, status: "取消", notes: null, created_at: `${demoDateOffset(4)}T09:00:00Z` },
  { id: 5006, order_number: "2606280006", order_date: demoDateOffset(15), buyer_name: "y***o", order_amount: 1099, transaction_fee: -33, free_shipping_subsidy: 0, extended_prep_fee: -22, payment_processing_fee: -22, seller_coupon: 0, platform_coupon: -50, net_revenue: 972, status: "已完成", notes: null, created_at: `${demoDateOffset(15)}T04:00:00Z` },
];

export const DEMO_SALES_ORDER_ITEMS: Record<number, SalesOrderItem[]> = {
  5001: [{ id: 50011, order_id: 5001, product_id: 2, product_name: DEMO_PRODUCTS[1].product_name, variant_name: DEMO_PRODUCTS[1].variant_name, qty: 1, unit_price: 599, subtotal: 599 }, { id: 50012, order_id: 5001, product_id: 1, product_name: DEMO_PRODUCTS[0].product_name, variant_name: DEMO_PRODUCTS[0].variant_name, qty: 1, unit_price: 99, subtotal: 99 }],
  5002: [{ id: 50021, order_id: 5002, product_id: 8, product_name: DEMO_PRODUCTS[7].product_name, variant_name: DEMO_PRODUCTS[7].variant_name, qty: 1, unit_price: 199, subtotal: 199 }],
  5003: [{ id: 50031, order_id: 5003, product_id: 2, product_name: DEMO_PRODUCTS[1].product_name, variant_name: DEMO_PRODUCTS[1].variant_name, qty: 2, unit_price: 599, subtotal: 1198 }],
  5004: [{ id: 50041, order_id: 5004, product_id: 2, product_name: DEMO_PRODUCTS[1].product_name, variant_name: DEMO_PRODUCTS[1].variant_name, qty: 1, unit_price: 599, subtotal: 599 }],
  5005: [{ id: 50051, order_id: 5005, product_id: 3, product_name: DEMO_PRODUCTS[2].product_name, variant_name: DEMO_PRODUCTS[2].variant_name, qty: 1, unit_price: 39, subtotal: 39 }],
  5006: [{ id: 50061, order_id: 5006, product_id: 8, product_name: DEMO_PRODUCTS[7].product_name, variant_name: DEMO_PRODUCTS[7].variant_name, qty: 1, unit_price: 199, subtotal: 199 }],
};

export const DEMO_AD_COSTS: AdCost[] = [
  { id: 4001, ad_date: demoDateOffset(1), amount: 620, description: "蝦皮商品廣告 - 收納好物", created_at: `${demoDateOffset(1)}T10:00:00Z` },
  { id: 4002, ad_date: demoDateOffset(3), amount: 480, description: "蝦皮商品廣告 - 浴廁區", created_at: `${demoDateOffset(3)}T10:00:00Z` },
  { id: 4003, ad_date: demoDateOffset(8), amount: 750, description: "蝦皮商品廣告 - 全站", created_at: `${demoDateOffset(8)}T10:00:00Z` },
];

export const DEMO_OPERATING_EXPENSES: OperatingExpense[] = [
  { id: 3001, expense_date: demoDateOffset(2), category: "包材", item_name: "氣泡袋", quantity: 500, description: null, amount: 850, notes: null, created_at: `${demoDateOffset(2)}T08:00:00Z` },
  { id: 3002, expense_date: demoDateOffset(6), category: "倉儲", item_name: "倉租", quantity: 1, description: null, amount: 3500, notes: "7 月倉租", created_at: `${demoDateOffset(6)}T08:00:00Z` },
  { id: 3003, expense_date: demoDateOffset(10), category: "設備", item_name: "標籤機碳帶", quantity: 3, description: null, amount: 540, notes: null, created_at: `${demoDateOffset(10)}T08:00:00Z` },
];
