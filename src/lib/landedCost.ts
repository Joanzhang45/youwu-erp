// 落地成本計算，公式一字不改沿用自 src/app/purchase/receiving/page.tsx
// （calcLandedCost / submitReceiving 內的計算邏輯，2026-07 舊版驗收入庫頁）。
// 抽成純函式供新版 /receive 流程呼叫，舊頁本身不變動。
//
// 公式：(CNY進價 x 匯率 x (1 + 海外刷卡手續費率%)) + (單品重量 / 批次總重量 x 集運總費用)

export interface LandedCostInput {
  purchasePriceCny: number | null;
  itemWeightKg: number | null;
  cnyRate: number;
  cardFeeRatePct: number;
  totalShipmentCostNtd: number;
  totalShipmentWeightKg: number;
}

export interface LandedCostResult {
  costBeforeShipping: number;
  shippingPerUnit: number;
  landedCostPerUnit: number;
  missingWeight: boolean;
}

export function calcLandedCost({
  purchasePriceCny,
  itemWeightKg,
  cnyRate,
  cardFeeRatePct,
  totalShipmentCostNtd,
  totalShipmentWeightKg,
}: LandedCostInput): LandedCostResult {
  const priceCny = Number(purchasePriceCny) || 0;
  const costBeforeShipping = priceCny * cnyRate * (1 + cardFeeRatePct / 100);

  const weight = Number(itemWeightKg) || 0;
  const totalWeight = Number(totalShipmentWeightKg) || 1;
  const totalCost = Number(totalShipmentCostNtd) || 0;
  const shippingPerUnit = totalWeight > 0 ? (weight / totalWeight) * totalCost : 0;

  return {
    costBeforeShipping,
    shippingPerUnit,
    landedCostPerUnit: costBeforeShipping + shippingPerUnit,
    missingWeight: weight <= 0,
  };
}
