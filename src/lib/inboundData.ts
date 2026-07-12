// 進貨鏈時間軸共用資料層（/inbound，PRD §5）。
//
// 關鍵資料層考古（2026-07-12 live DB 直查，見交付報告）：一張採購單對應的境內物流／集運
// 並非 1:1，而是 1:N（po_number 是文字比對，不是外鍵）——例如 PO-20250724-001 真實連到
// 24 筆 domestic_logistics（每個包裹一筆）與 4 個 consolidated_shipments（分批集運）。
// 這支檔案把「一張採購單 → 多筆物流／多個集運批次 → 對應點收紀錄」的聚合查詢與狀態判斷
// 集中在一處，同時餵給列表頁（批次算 5 節點目前進度）與詳情頁（完整節點明細）。
import { getSupabase } from "@/lib/supabase";
import type {
  ConsolidatedShipment,
  ConsolidatedShipmentItem,
  DomesticLogistics,
  ReceivingRecord,
} from "@/lib/database.types";
import { DEMO_DOMESTIC_LOGISTICS, DEMO_SHIPMENTS, DEMO_SHIPMENT_ITEMS } from "@/lib/demo-data-app";

export type ShipmentGroup = {
  shipment: ConsolidatedShipment;
  items: ConsolidatedShipmentItem[];
};

export type InboundChain = {
  logisticsByPo: Map<string, DomesticLogistics[]>;
  shipmentsByPo: Map<string, ShipmentGroup[]>;
  receivingByShipmentNumber: Map<string, ReceivingRecord>;
};

// 境內物流「已抵達集運倉／終態」的狀態集合（沿用 src/app/logistics/page.tsx 既有詞彙）
const LOGISTICS_DONE_STATUSES = new Set(["已到達", "已入倉", "已入庫", "異常", "取消"]);
// 集運「已到貨」的狀態集合（沿用 src/app/purchase/shipments/page.tsx 既有詞彙）
const SHIPMENT_ARRIVED_STATUSES = new Set(["已到達", "已驗收", "已入庫"]);

export function isLogisticsDone(status: string | null): boolean {
  return !!status && LOGISTICS_DONE_STATUSES.has(status);
}

export function isShipmentArrived(shipment: ConsolidatedShipment): boolean {
  return !!shipment.actual_arrival || (!!shipment.status && SHIPMENT_ARRIVED_STATUSES.has(shipment.status));
}

function emptyChain(): InboundChain {
  return {
    logisticsByPo: new Map(),
    shipmentsByPo: new Map(),
    receivingByShipmentNumber: new Map(),
  };
}

// 批次抓一組採購單號對應的物流／集運／點收資料，供列表（多單）與詳情（單一單）共用。
export async function fetchInboundChain(poNumbers: string[]): Promise<InboundChain> {
  const cleanNumbers = Array.from(new Set(poNumbers.filter(Boolean)));
  if (cleanNumbers.length === 0) return emptyChain();

  const supabase = getSupabase();
  const [logRes, shipItemRes] = await Promise.all([
    supabase.from("domestic_logistics").select("*").in("po_number", cleanNumbers),
    supabase.from("consolidated_shipment_items").select("*").in("po_number", cleanNumbers),
  ]);

  const logisticsByPo = new Map<string, DomesticLogistics[]>();
  for (const row of logRes.data || []) {
    if (!row.po_number) continue;
    const list = logisticsByPo.get(row.po_number) || [];
    list.push(row);
    logisticsByPo.set(row.po_number, list);
  }

  const shipItems = shipItemRes.data || [];
  const shipmentIds = Array.from(new Set(shipItems.map((r) => r.shipment_id)));
  let shipmentsById = new Map<number, ConsolidatedShipment>();
  if (shipmentIds.length > 0) {
    const { data: shipData } = await supabase.from("consolidated_shipments").select("*").in("id", shipmentIds);
    shipmentsById = new Map((shipData || []).map((s) => [s.id, s]));
  }

  const grouped = new Map<string, Map<number, ConsolidatedShipmentItem[]>>();
  for (const item of shipItems) {
    if (!item.po_number) continue;
    const byShipment = grouped.get(item.po_number) || new Map<number, ConsolidatedShipmentItem[]>();
    const list = byShipment.get(item.shipment_id) || [];
    list.push(item);
    byShipment.set(item.shipment_id, list);
    grouped.set(item.po_number, byShipment);
  }

  const shipmentsByPo = new Map<string, ShipmentGroup[]>();
  for (const [poNumber, byShipment] of grouped) {
    const groups: ShipmentGroup[] = [];
    for (const [shipmentId, items] of byShipment) {
      const shipment = shipmentsById.get(shipmentId);
      if (shipment) groups.push({ shipment, items });
    }
    groups.sort((a, b) => (b.shipment.departure_date || "").localeCompare(a.shipment.departure_date || ""));
    shipmentsByPo.set(poNumber, groups);
  }

  const receivingByShipmentNumber = new Map<string, ReceivingRecord>();
  const shipmentNumbers = Array.from(
    new Set(Array.from(shipmentsById.values()).map((s) => s.shipment_number).filter(Boolean) as string[])
  );
  if (shipmentNumbers.length > 0) {
    const { data: rvData } = await supabase
      .from("receiving_records")
      .select("*")
      .in("shipment_number", shipmentNumbers);
    for (const rv of rvData || []) {
      if (rv.shipment_number) receivingByShipmentNumber.set(rv.shipment_number, rv);
    }
  }

  return { logisticsByPo, shipmentsByPo, receivingByShipmentNumber };
}

// 5 節點目前進度（列表用的精簡版，詳情頁自己算更完整的每筆狀態）。
// completedIndex：目前已完成到第幾個節點（-1＝連下單都還沒確認）。
// 0=下單 1=境內物流 2=集運 3=到貨 4=點收入庫
export function computeStageIndex(
  po: { status_draft: boolean | null; status_received: boolean | null },
  logisticsList: DomesticLogistics[],
  shipmentGroups: ShipmentGroup[],
  receivingByShipmentNumber: Map<string, ReceivingRecord>
): number {
  let idx = -1;
  if (!po.status_draft) idx = 0;

  if (logisticsList.length > 0 && logisticsList.every((l) => isLogisticsDone(l.status))) {
    idx = Math.max(idx, 1);
  }

  const departedGroups = shipmentGroups.filter((g) => g.shipment.status !== "準備中");
  if (departedGroups.length > 0) idx = Math.max(idx, 2);

  const arrivedGroups = shipmentGroups.filter((g) => isShipmentArrived(g.shipment));
  if (arrivedGroups.length > 0) idx = Math.max(idx, 3);

  if (
    arrivedGroups.length > 0 &&
    arrivedGroups.every((g) => g.shipment.shipment_number && receivingByShipmentNumber.has(g.shipment.shipment_number))
  ) {
    idx = Math.max(idx, 4);
  }

  // 歷史資料常有連環缺口（物流/集運紀錄未必逐筆遷移），但已標記「已到貨」的舊單
  // 仍應視為點收完成，避免歷史清單顯示明明整單完成卻卡在中間節點。
  if (po.status_received) idx = 4;

  return idx;
}

export const STAGE_LABELS = ["下單", "境內物流", "集運", "到貨", "點收入庫"] as const;

// 展示模式版的 fetchInboundChain（同型別結構，來源改讀 demo-data-app 的固定資料，
// 供 /inbound 列表頁與 PurchaseOrderTimeline 共用，避免兩處各自兜一份 demo 聚合邏輯）。
export function buildDemoChain(poNumbers: string[]): InboundChain {
  const logisticsByPo = new Map<string, DomesticLogistics[]>();
  const shipmentsByPo = new Map<string, ShipmentGroup[]>();

  for (const poNumber of poNumbers) {
    const logistics = DEMO_DOMESTIC_LOGISTICS[poNumber];
    if (logistics && logistics.length > 0) logisticsByPo.set(poNumber, logistics);

    const groups: ShipmentGroup[] = [];
    for (const [sidStr, its] of Object.entries(DEMO_SHIPMENT_ITEMS)) {
      const matched = its.filter((i) => i.po_number === poNumber);
      if (matched.length === 0) continue;
      const shipment = DEMO_SHIPMENTS.find((s) => s.id === Number(sidStr));
      if (shipment) groups.push({ shipment, items: matched });
    }
    if (groups.length > 0) shipmentsByPo.set(poNumber, groups);
  }

  return { logisticsByPo, shipmentsByPo, receivingByShipmentNumber: new Map() };
}
