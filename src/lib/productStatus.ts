// 商品狀態口徑（缺貨/低庫存警示計數用）。
// 背景：products.product_status 實際值域（2026-07-16 live 查證）＝
//   常駐(135)／停售(19)／測品(6)／主力款(4)／季節款(1)，共 165 筆。
// 「非在售」＝不再需要行動的品項，警示計數要排除，避免雜訊蓋過真正缺貨的常駐/主力款。
// 只排除實際出現過的值，沒出現過的值不預先寫死（例如將來新增的狀態需另外評估）。
export const NON_SELLABLE_STATUSES = ["停售", "測品", "季節款"] as const;

export function isStockAlertEligible(status: string | null): boolean {
  return !NON_SELLABLE_STATUSES.includes(status as (typeof NON_SELLABLE_STATUSES)[number]);
}
