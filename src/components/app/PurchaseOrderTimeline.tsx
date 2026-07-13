"use client";

// 進貨鏈時間軸——單一採購單詳情（PRD §5、驗收契約 A10）。
// 五節點：下單→境內物流→集運→到貨→點收入庫，狀態推進用白話文案 CTA，
// 沿用既有欄位寫入（purchase_orders / domestic_logistics / consolidated_shipments），無 schema 變更。
//
// 資料層考古：一張採購單可能對到「多筆」境內物流與「多個」集運批次（po_number 文字比對，非 1:1，
// 見 src/lib/inboundData.ts 開頭註解）。物流筆數 ≤4 時逐筆給推進按鈕；超過門檻只給彙總＋可展開明細
// （不逐筆給按鈕），避免歷史批次資料把時間軸炸成按鈕長牆，違背改版反長牆病的初衷。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { DomesticLogistics, PurchaseOrder, PurchaseOrderItem, ReceivingRecord } from "@/lib/database.types";
import {
  computeStageIndex,
  fetchInboundChain,
  isLogisticsDone,
  isShipmentArrived,
  type ShipmentGroup,
} from "@/lib/inboundData";
import { ChevronRightIcon, CheckIcon, ReceiveIcon } from "./icons";

const LOGISTICS_INDIVIDUAL_THRESHOLD = 4;

const LOGISTICS_NEXT: Record<string, { next: string; cta: string }> = {
  待寄出: { next: "已寄出", cta: "標記已寄出" },
  已寄出: { next: "運送中", cta: "已經在路上了" },
  運送中: { next: "已入庫", cta: "貨到集運倉了" },
};

const SHIPMENT_NEXT: Record<string, { next: string; cta: string }> = {
  準備中: { next: "已出發", cta: "集運倉已出貨" },
  已出發: { next: "運送中", cta: "開始跨海運送" },
  運送中: { next: "已到達", cta: "貨到台灣了" },
};

const STATUS_BADGE: Record<string, string> = {
  待寄出: "bg-[#FAFAFA] text-[#8F8F8F] border-[#EAEAEA]",
  已寄出: "bg-[#0070F3]/10 text-[#0070F3] border-[#0070F3]/30",
  運送中: "bg-[#F5A623]/10 text-[#F5A623] border-[#F5A623]/30",
  已到達: "bg-[#0CCE6B]/10 text-[#0CCE6B] border-[#0CCE6B]/30",
  已出發: "bg-[#0070F3]/10 text-[#0070F3] border-[#0070F3]/30",
  準備中: "bg-[#FAFAFA] text-[#8F8F8F] border-[#EAEAEA]",
  已入倉: "bg-[#0CCE6B]/10 text-[#0CCE6B] border-[#0CCE6B]/30",
  已入庫: "bg-[#0CCE6B]/10 text-[#0CCE6B] border-[#0CCE6B]/30",
  已驗收: "bg-[#0CCE6B]/10 text-[#0CCE6B] border-[#0CCE6B]/30",
  異常: "bg-[#E00]/10 text-[#E00] border-[#E00]/30",
  取消: "bg-[#FAFAFA] text-[#8F8F8F] border-[#EAEAEA]",
};

function money(n: number | null | undefined): string {
  return Math.round(Number(n) || 0).toLocaleString();
}

type ChainData = {
  logistics: DomesticLogistics[];
  shipmentGroups: ShipmentGroup[];
  receivingByShipmentNumber: Map<string, ReceivingRecord>;
};

export function PurchaseOrderTimeline({ poId }: { poId: number }) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [chain, setChain] = useState<ChainData>({ logistics: [], shipmentGroups: [], receivingByShipmentNumber: new Map() });
  const [notFound, setNotFound] = useState(false);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [logisticsExpanded, setLogisticsExpanded] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const supabase = getSupabase();
      const [poRes, itemsRes] = await Promise.all([
        supabase.from("purchase_orders").select("*").eq("id", poId).single(),
        supabase.from("purchase_order_items").select("*").eq("po_id", poId).order("created_at"),
      ]);
      if (poRes.error || !poRes.data) {
        setNotFound(true);
        return;
      }
      setPo(poRes.data);
      setItems(itemsRes.data || []);

      const full = await fetchInboundChain([poRes.data.po_number]);
      setChain({
        logistics: full.logisticsByPo.get(poRes.data.po_number) || [],
        shipmentGroups: full.shipmentsByPo.get(poRes.data.po_number) || [],
        receivingByShipmentNumber: full.receivingByShipmentNumber,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, [poId, toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const markOrdered = async () => {
    if (!po) return;
    setBusyKey("order");
    try {
      const { error } = await getSupabase()
        .from("purchase_orders")
        .update({ status_draft: false, status_ordered: true })
        .eq("id", po.id);
      if (error) throw error;
      toast("已標記已下單");
      fetchAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "更新失敗", "error");
    } finally {
      setBusyKey(null);
    }
  };

  const advanceLogistics = async (record: DomesticLogistics) => {
    const step = record.status ? LOGISTICS_NEXT[record.status] : undefined;
    if (!step) return;
    setBusyKey(`log-${record.id}`);
    try {
      const patch: Partial<DomesticLogistics> = { status: step.next };
      if (step.next === "已入庫" && !record.actual_arrival) {
        patch.actual_arrival = new Date().toISOString().split("T")[0];
      }
      const { error } = await getSupabase().from("domestic_logistics").update(patch).eq("id", record.id);
      if (error) throw error;
      toast(step.cta);
      fetchAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "更新失敗", "error");
    } finally {
      setBusyKey(null);
    }
  };

  const advanceShipment = async (group: ShipmentGroup) => {
    const step = group.shipment.status ? SHIPMENT_NEXT[group.shipment.status] : undefined;
    if (!step) return;
    setBusyKey(`ship-${group.shipment.id}`);
    try {
      const patch: Record<string, string> = { status: step.next };
      if (step.next === "已到達") patch.actual_arrival = new Date().toISOString().split("T")[0];
      const { error } = await getSupabase().from("consolidated_shipments").update(patch).eq("id", group.shipment.id);
      if (error) throw error;
      toast(step.cta);
      fetchAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "更新失敗", "error");
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-[#8F8F8F] text-sm">載入中...</div>;
  }

  if (notFound || !po) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-[#E00] mb-3 text-sm">找不到這張採購單</p>
          <Link href="/inbound" className="text-[#0070F3] text-sm underline">
            返回進貨列表
          </Link>
        </div>
      </div>
    );
  }

  const stageIndex = computeStageIndex(po, chain.logistics, chain.shipmentGroups, chain.receivingByShipmentNumber);
  const arrivedGroups = chain.shipmentGroups.filter((g) => isShipmentArrived(g.shipment));
  const latestArrival = arrivedGroups
    .map((g) => g.shipment.actual_arrival)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];
  const logisticsDoneCount = chain.logistics.filter((l) => isLogisticsDone(l.status)).length;
  const totalCnySubtotal = items.reduce((sum, i) => sum + (Number(i.subtotal_cny) || 0), 0) || Number(po.subtotal_cny) || 0;

  return (
    <div className="min-h-screen bg-white app-fade-up-enter">
      <header className="px-5 pt-5 pb-3 max-w-2xl mx-auto">
        <Link href="/inbound" className="text-xs text-[#0070F3] hover:underline">
          ← 進貨
        </Link>
        <h1 className="text-xl font-semibold text-[#171717] tracking-tight mt-1 font-mono">{po.po_number}</h1>
        <p className="text-sm text-[#8F8F8F] mt-0.5">
          {po.order_date || "未設定日期"} · {po.purchaser || "未指定採購人"}
        </p>
      </header>

      {/* Blocker 修復（tester A10 R1）：底部固定 AppTabBar 高度約 64px，短內容的採購單
          （節點內容少、無需捲動）在 scrollY=0 時，最後一個節點「點收入庫」的 CTA 剛好落在
          導覽列的固定覆蓋區內——導覽列 DOM 在後、z-index 較高，實際觸控命中的是導覽列而非
          CTA。trailing padding（main 底部留白）救不了這個情況，因為使用者一開始就沒捲動，
          CTA 的畫面座標完全由「它上面所有節點的高度總和」決定；要讓它在靜止狀態就避開導覽列
          覆蓋區，得縮小節點間距把它往上推，而不是在它下面加更多留白（那只在使用者主動往下捲
          時才有用）。同一批收斂 header 上下 padding，三個 /inbound 子頁視覺一致。 */}
      <main className="px-5 max-w-2xl mx-auto pb-24">
        <ol className="space-y-0">
          {/* 節點 1：下單 */}
          <TimelineStep index={0} stageIndex={stageIndex} last={false}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#171717]">下單</p>
                <p className="text-xs text-[#8F8F8F] mt-0.5">
                  {items.length} 個品項 · ¥{totalCnySubtotal.toFixed(2)} → NT${money(po.grand_total)}
                </p>
              </div>
              {po.status_draft && (
                <button
                  onClick={markOrdered}
                  disabled={busyKey === "order"}
                  className="flex-shrink-0 min-h-11 px-3 rounded-lg bg-[#171717] text-white text-xs font-medium active:scale-[0.97] transition-transform duration-150 disabled:opacity-50"
                >
                  {busyKey === "order" ? "處理中..." : "標記已下單"}
                </button>
              )}
            </div>
            {items.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setItemsExpanded((v) => !v)}
                  className="text-xs text-[#0070F3] hover:underline"
                >
                  {itemsExpanded ? "收合品項" : `展開品項（${items.length}）`}
                </button>
                {itemsExpanded && (
                  <div className="mt-2 rounded-xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
                    {items.map((item) => (
                      <div key={item.id} className="px-3 py-2.5 flex items-center gap-2.5">
                        {item.product_image ? (
                          <img src={item.product_image} alt="" className="w-9 h-9 rounded-lg object-cover bg-[#FAFAFA] flex-shrink-0" />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-[#FAFAFA] flex items-center justify-center flex-shrink-0 text-sm">📦</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[#171717] truncate">{item.product_name}</p>
                          {item.variant_name && <p className="text-[11px] text-[#8F8F8F] truncate">{item.variant_name}</p>}
                        </div>
                        <p className="text-[11px] text-[#8F8F8F] flex-shrink-0 tabular-nums">
                          x{item.qty} · ¥{Number(item.subtotal_cny || 0).toFixed(2)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </TimelineStep>

          {/* 節點 2：境內物流 */}
          <TimelineStep index={1} stageIndex={stageIndex} last={false}>
            <p className="text-sm font-semibold text-[#171717]">境內物流</p>
            {chain.logistics.length === 0 ? (
              <p className="text-xs text-[#8F8F8F] mt-1">尚未建立物流紀錄</p>
            ) : (
              <>
                <p className="text-xs text-[#8F8F8F] mt-0.5">
                  {chain.logistics.length} 個包裹 · {logisticsDoneCount} 個已抵達集運倉
                </p>
                {chain.logistics.length <= LOGISTICS_INDIVIDUAL_THRESHOLD ? (
                  <div className="mt-2 space-y-2">
                    {chain.logistics.map((rec) => (
                      <LogisticsRow key={rec.id} record={rec} busy={busyKey === `log-${rec.id}`} onAdvance={() => advanceLogistics(rec)} />
                    ))}
                  </div>
                ) : (
                  <div className="mt-2">
                    <button onClick={() => setLogisticsExpanded((v) => !v)} className="text-xs text-[#0070F3] hover:underline">
                      {logisticsExpanded ? "收合明細" : "查看物流明細（唯讀，逐筆編輯請至舊版物流頁）"}
                    </button>
                    {logisticsExpanded && (
                      <div className="mt-2 rounded-xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden max-h-72 overflow-y-auto">
                        {chain.logistics.map((rec) => (
                          <div key={rec.id} className="px-3 py-2 flex items-center justify-between gap-2">
                            <p className="text-[11px] font-mono text-[#171717] truncate">{rec.tracking_number || "無單號"}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border flex-shrink-0 ${STATUS_BADGE[rec.status || ""] || ""}`}>
                              {rec.status || "-"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </TimelineStep>

          {/* 節點 3：集運 */}
          <TimelineStep index={2} stageIndex={stageIndex} last={false}>
            <p className="text-sm font-semibold text-[#171717]">集運</p>
            {chain.shipmentGroups.length === 0 ? (
              <p className="text-xs text-[#8F8F8F] mt-1">尚未建立集運批次</p>
            ) : (
              <div className="mt-2 space-y-2">
                {chain.shipmentGroups.map((g) => (
                  <ShipmentRow key={g.shipment.id} group={g} busy={busyKey === `ship-${g.shipment.id}`} onAdvance={() => advanceShipment(g)} />
                ))}
              </div>
            )}
          </TimelineStep>

          {/* 節點 4：到貨 */}
          <TimelineStep index={3} stageIndex={stageIndex} last={false}>
            <p className="text-sm font-semibold text-[#171717]">到貨</p>
            {chain.shipmentGroups.length === 0 ? (
              <p className="text-xs text-[#8F8F8F] mt-1">尚無集運批次可等待到貨</p>
            ) : arrivedGroups.length === 0 ? (
              <p className="text-xs text-[#8F8F8F] mt-1">等待到貨中</p>
            ) : (
              <p className="text-xs text-[#0CCE6B] mt-1 font-medium">
                {arrivedGroups.length}/{chain.shipmentGroups.length} 批已到貨{latestArrival ? `（最近 ${latestArrival}）` : ""}
              </p>
            )}
          </TimelineStep>

          {/* 節點 5：點收入庫 */}
          <TimelineStep index={4} stageIndex={stageIndex} last>
            <p className="text-sm font-semibold text-[#171717]">點收入庫</p>
            {arrivedGroups.length === 0 ? (
              po.status_received ? (
                <p className="text-xs text-[#0CCE6B] mt-1 font-medium">已完成點收（歷史紀錄，落地成本已計入商品成本）</p>
              ) : (
                <p className="text-xs text-[#8F8F8F] mt-1">還沒到貨，先不能點收</p>
              )
            ) : (
              <div className="mt-2 space-y-2">
                {arrivedGroups.map((g) => {
                  const rv = g.shipment.shipment_number ? chain.receivingByShipmentNumber.get(g.shipment.shipment_number) : undefined;
                  if (rv) {
                    return (
                      <div key={g.shipment.id} className="rounded-xl border border-[#EAEAEA] p-3 flex items-center gap-2.5 bg-[#FAFAFA]">
                        <div className="w-8 h-8 rounded-full bg-[#0CCE6B]/10 flex items-center justify-center flex-shrink-0">
                          <CheckIcon className="w-4 h-4 text-[#0CCE6B]" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[#171717]">
                            {g.shipment.shipment_number} 已完成點收
                          </p>
                          <p className="text-[11px] text-[#8F8F8F] mt-0.5">
                            {rv.receiver || "-"} · {rv.receiving_date || "-"}
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={g.shipment.id}
                      href={`/receive?shipment_id=${g.shipment.id}`}
                      className="flex items-center gap-2.5 rounded-xl border border-[#EAEAEA] p-3 hover:border-[#171717] transition-colors duration-150"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#0070F3]/10 flex items-center justify-center flex-shrink-0">
                        <ReceiveIcon className="w-4 h-4 text-[#0070F3]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#171717]">前往點收（{g.shipment.shipment_number}）</p>
                        <p className="text-[11px] text-[#8F8F8F] mt-0.5">{g.items.length} 個品項待點收</p>
                      </div>
                      <ChevronRightIcon className="w-4 h-4 text-[#8F8F8F] flex-shrink-0" />
                    </Link>
                  );
                })}
              </div>
            )}
          </TimelineStep>
        </ol>
      </main>
    </div>
  );
}

function TimelineStep({
  index,
  stageIndex,
  last,
  children,
}: {
  index: number;
  stageIndex: number;
  last: boolean;
  children: React.ReactNode;
}) {
  const done = stageIndex >= index;
  const active = stageIndex === index - 1;
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
        <div
          className={`w-3 h-3 rounded-full border-2 transition-colors duration-150 ${
            done
              ? "bg-[#171717] border-[#171717]"
              : active
              ? "bg-white border-[#171717]"
              : "bg-white border-[#EAEAEA]"
          }`}
        />
        {!last && <div className={`w-px flex-1 min-h-[1.75rem] mt-1 ${done ? "bg-[#171717]" : "bg-[#EAEAEA]"}`} />}
      </div>
      <div className="flex-1 min-w-0 pb-4">{children}</div>
    </li>
  );
}

function LogisticsRow({
  record,
  busy,
  onAdvance,
}: {
  record: DomesticLogistics;
  busy: boolean;
  onAdvance: () => void;
}) {
  const step = record.status ? LOGISTICS_NEXT[record.status] : undefined;
  return (
    <div className="rounded-xl border border-[#EAEAEA] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-mono text-[#171717] truncate">{record.tracking_number || "無單號"}</p>
          <p className="text-[11px] text-[#8F8F8F] mt-0.5">
            {record.logistics_company || "-"}
            {record.total_weight_kg != null ? ` · ${record.total_weight_kg}kg` : ""}
          </p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 font-medium ${STATUS_BADGE[record.status || ""] || ""}`}>
          {record.status || "-"}
        </span>
      </div>
      {step && (
        <button
          onClick={onAdvance}
          disabled={busy}
          className="mt-2 w-full min-h-11 rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] text-xs font-medium text-[#171717] hover:border-[#171717] transition-colors duration-150 disabled:opacity-50"
        >
          {busy ? "處理中..." : step.cta}
        </button>
      )}
    </div>
  );
}

function ShipmentRow({
  group,
  busy,
  onAdvance,
}: {
  group: ShipmentGroup;
  busy: boolean;
  onAdvance: () => void;
}) {
  const s = group.shipment;
  const step = s.status ? SHIPMENT_NEXT[s.status] : undefined;
  return (
    <div className="rounded-xl border border-[#EAEAEA] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-mono text-[#171717] truncate">{s.shipment_number}</p>
          <p className="text-[11px] text-[#8F8F8F] mt-0.5">
            {s.forwarder || "-"} · {s.shipping_method || "-"} · {group.items.length} 個品項
          </p>
          {s.total_cost_ntd != null && Number(s.total_cost_ntd) > 0 && (
            <p className="text-[11px] text-[#8F8F8F] mt-0.5">運費成本 NT${money(s.total_cost_ntd)}</p>
          )}
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 font-medium ${STATUS_BADGE[s.status || ""] || ""}`}>
          {s.status || "-"}
        </span>
      </div>
      {step && (
        <button
          onClick={onAdvance}
          disabled={busy}
          className="mt-2 w-full min-h-11 rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] text-xs font-medium text-[#171717] hover:border-[#171717] transition-colors duration-150 disabled:opacity-50"
        >
          {busy ? "處理中..." : step.cta}
        </button>
      )}
    </div>
  );
}
