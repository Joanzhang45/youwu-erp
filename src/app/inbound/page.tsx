"use client";

// 進貨鏈時間軸首頁（PRD §3、§5）。以「採購單」為主軸，取代 /selections /purchase
// /purchase/detail /purchase/shipments /logistics 五頁的功能，改成任務導向單一時間軸視圖。
// 無動態路由（static export 限制）：?id= 進單一採購單詳情、?selection_id= 進選品候選詳情、
// 都沒有則是本頁（進行中列表＋歷史摺疊＋選品候選入口）。
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import type { PurchaseOrder } from "@/lib/database.types";
import { DEMO_PURCHASE_ORDERS } from "@/lib/demo-data-app";
import { buildDemoChain, computeStageIndex, fetchInboundChain, STAGE_LABELS, type InboundChain } from "@/lib/inboundData";
import { PurchaseOrderTimeline } from "@/components/app/PurchaseOrderTimeline";
import { SelectionCandidateDetail, SelectionCandidatesSection } from "@/components/app/SelectionCandidates";
import { ChevronRightIcon } from "@/components/app/icons";

const HISTORY_PAGE_SIZE = 20;

export default function InboundPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[#8F8F8F] text-sm">載入中...</div>}>
      <InboundContent />
    </Suspense>
  );
}

function InboundContent() {
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");
  const selectionIdParam = searchParams.get("selection_id");

  if (idParam) return <PurchaseOrderTimeline poId={Number(idParam)} />;
  if (selectionIdParam) return <SelectionCandidateDetail id={Number(selectionIdParam)} />;
  return <InboundHome />;
}

function money(n: number | null | undefined): string {
  return Math.round(Number(n) || 0).toLocaleString();
}

function InboundHome() {
  const { isDemo } = useAuth();
  const [active, setActive] = useState<PurchaseOrder[]>([]);
  const [chain, setChain] = useState<InboundChain>({
    logisticsByPo: new Map(),
    shipmentsByPo: new Map(),
    receivingByShipmentNumber: new Map(),
  });
  const [loading, setLoading] = useState(true);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<PurchaseOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [historyTotal, setHistoryTotal] = useState<number | null>(null);

  const fetchActive = useCallback(async () => {
    setLoading(true);
    try {
      if (isDemo) {
        const list = DEMO_PURCHASE_ORDERS.filter((p) => !p.status_received && !p.status_cancelled);
        setActive(list);
        setChain(buildDemoChain(list.map((p) => p.po_number)));
        return;
      }
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("*")
        .eq("status_received", false)
        .eq("status_cancelled", false)
        .order("order_date", { ascending: true })
        .limit(50);
      if (error) throw error;
      const list = data || [];
      setActive(list);
      setChain(await fetchInboundChain(list.map((p) => p.po_number)));
    } catch {
      setActive([]);
    } finally {
      setLoading(false);
    }
  }, [isDemo]);

  useEffect(() => {
    fetchActive();
  }, [fetchActive]);

  const loadHistory = useCallback(
    async (reset: boolean) => {
      setHistoryLoading(true);
      try {
        if (isDemo) {
          const list = DEMO_PURCHASE_ORDERS.filter((p) => p.status_received || p.status_cancelled);
          setHistory(list);
          setHistoryHasMore(false);
          setHistoryTotal(list.length);
          return;
        }
        const supabase = getSupabase();
        const offset = reset ? 0 : historyOffset;
        const { data, error, count } = await supabase
          .from("purchase_orders")
          .select("*", { count: "exact" })
          .or("status_received.eq.true,status_cancelled.eq.true")
          .order("order_date", { ascending: false })
          .range(offset, offset + HISTORY_PAGE_SIZE - 1);
        if (error) throw error;
        const rows = data || [];
        setHistory((prev) => (reset ? rows : [...prev, ...rows]));
        setHistoryOffset(offset + rows.length);
        setHistoryTotal(count ?? null);
        setHistoryHasMore(rows.length === HISTORY_PAGE_SIZE);
      } catch {
        setHistoryHasMore(false);
      } finally {
        setHistoryLoading(false);
      }
    },
    [isDemo, historyOffset]
  );

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history.length === 0) loadHistory(true);
  };

  return (
    <div className="min-h-screen bg-white">
      {isDemo && (
        <div className="bg-[#F5A623] text-[#171717] text-xs text-center py-1 font-medium">
          展示模式 — 資料為模擬
        </div>
      )}

      <header className="px-5 pt-6 pb-4 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">進貨</h1>
        <p className="text-sm text-[#8F8F8F] mt-0.5">選品 → 採購 → 集運 → 到貨 → 點收，一條鏈看完</p>
      </header>

      {/* pb-24（非 pb-10）：底部固定 AppTabBar 淨空加大，比照 PurchaseOrderTimeline 同批修復
          （tester A10 R1 Blocker），讓「選品候選」區塊的「載入更多」按鈕與歷史列表最後一列
          在捲到底時也有足夠的觸控淨空，不被導覽列遮蔽。 */}
      <main className="px-5 max-w-2xl mx-auto pb-24">
        {loading ? (
          <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
        ) : active.length === 0 ? (
          <div className="rounded-2xl border border-[#EAEAEA] p-6 text-center">
            <p className="text-sm text-[#8F8F8F]">目前沒有進行中的採購單</p>
          </div>
        ) : (
          <div className="space-y-3 app-fade-up-enter">
            {active.map((po) => (
              <InboundOrderCard key={po.id} po={po} chain={chain} />
            ))}
          </div>
        )}

        {/* 歷史（預設只顯進行中，歷史摺疊＋分頁載入——舊 /purchase 頁「數百單全列」長牆病禁重現） */}
        <div className="mt-6">
          <button
            onClick={toggleHistory}
            className="w-full flex items-center justify-between py-2.5 text-sm text-[#8F8F8F]"
          >
            <span>{historyOpen ? "收合歷史採購單" : `顯示歷史採購單${historyTotal != null ? `（共 ${historyTotal} 筆）` : ""}`}</span>
            <ChevronRightIcon className={`w-4 h-4 transition-transform duration-150 ${historyOpen ? "rotate-90" : ""}`} />
          </button>
          {historyOpen && (
            <div className="mt-2 app-fade-up-enter">
              {historyLoading && history.length === 0 ? (
                <div className="text-center py-8 text-[#8F8F8F] text-sm">載入中...</div>
              ) : history.length === 0 ? (
                <p className="text-center text-sm text-[#8F8F8F] py-6">尚無歷史採購單</p>
              ) : (
                <>
                  <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
                    {history.map((po) => (
                      <HistoryRow key={po.id} po={po} />
                    ))}
                  </div>
                  {historyHasMore && (
                    <button
                      onClick={() => loadHistory(false)}
                      disabled={historyLoading}
                      className="w-full mt-3 py-2.5 text-sm text-[#0070F3] hover:underline disabled:opacity-50"
                    >
                      {historyLoading ? "載入中..." : "載入更多"}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <SelectionCandidatesSection />
      </main>
    </div>
  );
}

function InboundOrderCard({ po, chain }: { po: PurchaseOrder; chain: InboundChain }) {
  const logistics = chain.logisticsByPo.get(po.po_number) || [];
  const shipmentGroups = chain.shipmentsByPo.get(po.po_number) || [];
  const stageIndex = computeStageIndex(po, logistics, shipmentGroups, chain.receivingByShipmentNumber);

  return (
    <Link
      href={`/inbound?id=${po.id}`}
      className="block rounded-2xl border border-[#EAEAEA] p-4 hover:border-[#171717] transition-colors duration-150 bg-white"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#171717] font-mono truncate">{po.po_number}</p>
          <p className="text-xs text-[#8F8F8F] mt-0.5">
            {po.order_date || "-"} · {po.purchaser || "未指定"}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold text-[#171717] tabular-nums">NT${money(po.grand_total)}</p>
          {po.status_abnormal != null && po.status_abnormal > 0 && (
            <p className="text-[11px] text-[#E00] mt-0.5">{po.status_abnormal} 項異常</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {STAGE_LABELS.map((label, idx) => (
          <div key={label} className="flex-1 flex flex-col items-center gap-1">
            <div className={`h-1.5 w-full rounded-full ${idx <= stageIndex ? "bg-[#171717]" : "bg-[#EAEAEA]"}`} />
            <span className={`text-[9px] ${idx <= stageIndex ? "text-[#171717]" : "text-[#8F8F8F]"}`}>{label}</span>
          </div>
        ))}
      </div>
    </Link>
  );
}

function HistoryRow({ po }: { po: PurchaseOrder }) {
  const label = po.status_cancelled ? "已取消" : "已到貨";
  return (
    <Link
      href={`/inbound?id=${po.id}`}
      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#FAFAFA] transition-colors duration-150"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#171717] font-mono truncate">{po.po_number}</p>
        <p className="text-xs text-[#8F8F8F] mt-0.5">
          {po.order_date || "-"} · {po.purchaser || "未指定"}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
            po.status_cancelled
              ? "bg-[#FAFAFA] text-[#8F8F8F] border-[#EAEAEA]"
              : "bg-[#0CCE6B]/10 text-[#0CCE6B] border-[#0CCE6B]/30"
          }`}
        >
          {label}
        </span>
        <ChevronRightIcon className="w-4 h-4 text-[#8F8F8F]" />
      </div>
    </Link>
  );
}
