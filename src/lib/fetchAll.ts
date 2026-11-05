// 分批抓全量：本專案 Supabase db-max-rows=1000，訂單與品項都已破千，聚合一律走 range() 迴圈。
// 分頁一定要有固定排序，否則 PostgreSQL 不保證跨頁順序，會漏列或重複列（2026-11-05 健檢 #10）。
// 所以這裡由 helper 自己加 .order(orderBy)，呼叫端只負責 select 與篩選。
export async function fetchAllRows<T>(
  // PostgrestFilterBuilder 型別鏈很深，結構化約束會觸發 TS2589，這裡單點放寬。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => any,
  orderBy = "id",
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await build()
      .order(orderBy, { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

// 訂單品項的成本：優先用賣出當下的成本快照（migration 012），舊資料沒有快照才退回商品目前成本。
export function itemUnitCost(
  item: { product_id: number | null; unit_cost_at_sale?: number | string | null },
  currentCost: Map<number, number> | Record<number, number>
): number {
  if (item.unit_cost_at_sale != null) return Number(item.unit_cost_at_sale) || 0;
  if (item.product_id == null) return 0;
  const v = currentCost instanceof Map ? currentCost.get(item.product_id) : currentCost[item.product_id];
  return v || 0;
}

export const CANCELLED_STATUS = "不成立";
