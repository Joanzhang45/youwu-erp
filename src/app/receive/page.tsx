"use client";

// 到貨點收（PRD §4.2）。無 shipment_id query param = 選單畫面；有則進逐項點收流程。
// 沿用既有「no dynamic route → query params」慣例（同 /purchase/receiving?shipment_id=）。
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import type { ConsolidatedShipment } from "@/lib/database.types";
import { RequireAuth } from "@/components/app/RequireAuth";
import { ReceivingFlow } from "@/components/app/ReceivingFlow";
import { ReceiveIcon } from "@/components/app/icons";

const STATUS_STYLE: Record<string, string> = {
  準備中: "bg-[#FAFAFA] text-[#8F8F8F] border-[#EAEAEA]",
  已出發: "bg-[#0070F3]/10 text-[#0070F3] border-[#0070F3]/30",
  運送中: "bg-[#F5A623]/10 text-[#F5A623] border-[#F5A623]/30",
  已到達: "bg-[#0CCE6B]/10 text-[#0CCE6B] border-[#0CCE6B]/30",
};

export default function ReceivePage() {
  return (
    <RequireAuth>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[#8F8F8F] text-sm">載入中...</div>}>
        <ReceiveContent />
      </Suspense>
    </RequireAuth>
  );
}

function ReceiveContent() {
  const searchParams = useSearchParams();
  const shipmentIdParam = searchParams.get("shipment_id");
  const shipmentId = shipmentIdParam ? Number(shipmentIdParam) : null;

  if (shipmentId) {
    return <ReceivingFlow shipmentId={shipmentId} />;
  }
  return <ShipmentSelectionList />;
}

function ShipmentSelectionList() {
  const [shipments, setShipments] = useState<ConsolidatedShipment[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("consolidated_shipments")
        .select("*")
        .in("status", ["準備中", "已出發", "運送中", "已到達"])
        .order("expected_arrival", { ascending: true });
      if (error) throw error;
      const list = data || [];
      setShipments(list);

      if (list.length > 0) {
        const { data: items } = await supabase
          .from("consolidated_shipment_items")
          .select("id, shipment_id")
          .in("shipment_id", list.map((s) => s.id));
        const counts: Record<number, number> = {};
        for (const i of items || []) {
          counts[i.shipment_id] = (counts[i.shipment_id] || 0) + 1;
        }
        setItemCounts(counts);
      }
    } catch {
      setShipments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  return (
    <div className="min-h-screen bg-white">
      <header className="px-5 pt-6 pb-4 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">到貨點收</h1>
        <p className="text-sm text-[#8F8F8F] mt-0.5">在途與已到達的集運單</p>
      </header>

      <main className="px-5 max-w-2xl mx-auto pb-8">
        {loading ? (
          <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
        ) : shipments.length === 0 ? (
          <div className="rounded-2xl border border-[#EAEAEA] p-8 text-center">
            <p className="text-sm text-[#8F8F8F]">目前沒有在途或待點收的集運單</p>
          </div>
        ) : (
          <div className="space-y-3 app-fade-up-enter">
            {shipments.map((s) => {
              const arrived = s.status === "已到達";
              const count = itemCounts[s.id] ?? 0;
              const CardInner = (
                <div
                  className={`rounded-2xl border p-4 transition-colors duration-150 ${
                    arrived ? "border-[#EAEAEA] hover:border-[#171717] bg-white" : "border-[#EAEAEA] bg-[#FAFAFA]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#171717] font-mono">{s.shipment_number}</p>
                      <p className="text-xs text-[#8F8F8F] mt-0.5">
                        {s.forwarder} · {s.shipping_method} · {count} 個品項
                      </p>
                    </div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium border flex-shrink-0 ${STATUS_STYLE[s.status || ""] || ""}`}>
                      {s.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#8F8F8F]">
                    預計到貨 {s.expected_arrival || "—"}
                  </p>
                  {arrived && (
                    <div className="flex items-center gap-1.5 mt-3 text-sm font-medium text-[#0CCE6B]">
                      <ReceiveIcon className="w-4 h-4" />
                      開始點收
                    </div>
                  )}
                </div>
              );
              return arrived ? (
                <Link key={s.id} href={`/receive?shipment_id=${s.id}`} className="block">
                  {CardInner}
                </Link>
              ) : (
                <div key={s.id}>{CardInner}</div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
