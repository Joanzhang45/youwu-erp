"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import type { ConsolidatedShipment } from "@/lib/database.types";
import {
  DEMO_SHIPMENTS,
  DEMO_SHIPMENT_ITEMS,
  DEMO_RECENT_ACTIVITY,
  DEMO_LAST_STOCKTAKE_DAYS,
  DEMO_KPI,
} from "@/lib/demo-data-app";
import { ReceiveIcon, ChevronRightIcon } from "@/components/app/icons";

type ArrivedTask = { shipment: ConsolidatedShipment; itemCount: number };
type ActivityRow = { id: number; text: string; time: string };

type TodayData = {
  arrived: ArrivedTask[];
  inTransitCount: number;
  lastStocktakeDays: number | null;
  kpi: { monthRevenue: number; monthOrders: number; outOfStock: number; lowStock: number };
  recent: ActivityRow[];
};

const MOVEMENT_LABEL: Record<string, (qty: number) => string> = {
  purchase_receive: (q) => `入庫 +${q}`,
  sale_ship: (q) => `出貨 ${q}`,
  manual_adjust: (q) => `調整 ${q > 0 ? "+" : ""}${q}`,
  return_reversal: (q) => `退貨回沖 +${q}`,
};

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === y.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return `今天 ${hm}`;
  if (isYesterday) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function TodayPage() {
  const { isDemo } = useAuth();
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (isDemo) {
      const arrived = DEMO_SHIPMENTS.filter((s) => s.status === "已到達").map((s) => ({
        shipment: s,
        itemCount: DEMO_SHIPMENT_ITEMS[s.id]?.length ?? 0,
      }));
      const inTransitCount = DEMO_SHIPMENTS.filter((s) =>
        ["準備中", "已出發", "運送中"].includes(s.status || "")
      ).length;
      setData({
        arrived,
        inTransitCount,
        lastStocktakeDays: DEMO_LAST_STOCKTAKE_DAYS,
        kpi: DEMO_KPI,
        recent: DEMO_RECENT_ACTIVITY,
      });
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const supabase = getSupabase();
      const [shipRes, kpiRes, monthRes, snapshotRes, ledgerRes] = await Promise.all([
        supabase
          .from("consolidated_shipments")
          .select("*")
          .in("status", ["準備中", "已出發", "運送中", "已到達"])
          .order("expected_arrival", { ascending: true }),
        supabase.from("v_dashboard_kpi").select("out_of_stock_count, low_stock_count").maybeSingle(),
        supabase.from("v_monthly_revenue").select("month, order_count, net_revenue").order("month", { ascending: false }).limit(3),
        supabase.from("stock_snapshots").select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1),
        supabase.from("inventory_ledger").select("id, product_id, movement_type, qty_delta, note, occurred_at").order("occurred_at", { ascending: false }).limit(5),
      ]);

      const shipments = shipRes.data || [];
      const arrivedShipments = shipments.filter((s) => s.status === "已到達");
      const inTransitCount = shipments.filter((s) => s.status !== "已到達").length;

      let arrived: ArrivedTask[] = [];
      if (arrivedShipments.length > 0) {
        const { data: items } = await supabase
          .from("consolidated_shipment_items")
          .select("id, shipment_id")
          .in("shipment_id", arrivedShipments.map((s) => s.id));
        arrived = arrivedShipments.map((s) => ({
          shipment: s,
          itemCount: (items || []).filter((i) => i.shipment_id === s.id).length,
        }));
      }

      const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      // 只認當月那一列，本月無訂單就誠實顯示 0，不要偷用上個月數字冒充「本月」
      const monthRow = (monthRes.data || []).find((r) => r.month === thisMonth);

      let recent: ActivityRow[] = [];
      const ledgerRows = ledgerRes.data || [];
      if (ledgerRows.length > 0) {
        const { data: prods } = await supabase
          .from("products")
          .select("id, product_name, variant_name")
          .in("id", ledgerRows.map((r) => r.product_id));
        const prodMap = new Map((prods || []).map((p) => [p.id, p]));
        recent = ledgerRows.map((r) => {
          const prod = prodMap.get(r.product_id);
          const name = prod ? `${prod.product_name}${prod.variant_name ? `（${prod.variant_name}）` : ""}` : "商品";
          const label = MOVEMENT_LABEL[r.movement_type]?.(r.qty_delta) ?? `異動 ${r.qty_delta}`;
          return { id: r.id, text: `${name} ${label}`, time: timeAgo(r.occurred_at) };
        });
      }

      const lastSnapshot = snapshotRes.data?.[0]?.snapshot_date;
      const lastStocktakeDays = lastSnapshot
        ? Math.floor((Date.now() - new Date(lastSnapshot).getTime()) / 86400000)
        : null;

      setData({
        arrived,
        inTransitCount,
        lastStocktakeDays,
        kpi: {
          monthRevenue: Number(monthRow?.net_revenue) || 0,
          monthOrders: Number(monthRow?.order_count) || 0,
          outOfStock: kpiRes.data?.out_of_stock_count || 0,
          lowStock: kpiRes.data?.low_stock_count || 0,
        },
        recent,
      });
    } catch {
      setData({
        arrived: [],
        inTransitCount: 0,
        lastStocktakeDays: null,
        kpi: { monthRevenue: 0, monthOrders: 0, outOfStock: 0, lowStock: 0 },
        recent: [],
      });
    } finally {
      setLoading(false);
    }
  }, [isDemo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const today = new Date();
  const weekday = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"][today.getDay()];
  const dateLabel = `${today.getMonth() + 1}月${today.getDate()}日 ${weekday}`;

  const hasTasks = !loading && data && (data.arrived.length > 0 || data.inTransitCount > 0);

  return (
    <div className="min-h-screen bg-white">
      {isDemo && (
        <div className="bg-[#F5A623] text-[#171717] text-xs text-center py-1 font-medium">
          展示模式 — 資料為模擬
        </div>
      )}

      <header className="px-5 pt-6 pb-4 max-w-2xl mx-auto">
        <p className="text-sm text-[#8F8F8F]">{dateLabel}</p>
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight mt-0.5">今天</h1>
      </header>

      <main className="px-5 max-w-2xl mx-auto pb-8">
        {loading ? (
          <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
        ) : (
          <div className="space-y-3 app-fade-up-enter">
            {/* 待點收任務卡 */}
            {data?.arrived.map(({ shipment, itemCount }) => (
              <Link
                key={shipment.id}
                href={`/receive?shipment_id=${shipment.id}`}
                className="block rounded-2xl border border-[#EAEAEA] p-4 hover:border-[#171717] transition-colors duration-150 bg-white"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#0CCE6B]/10 flex items-center justify-center flex-shrink-0">
                    <ReceiveIcon className="w-5 h-5 text-[#0CCE6B]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#171717]">
                      {shipment.shipment_number} 已到貨，待點收
                    </p>
                    <p className="text-xs text-[#8F8F8F] mt-0.5">{itemCount} 個品項</p>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-[#8F8F8F] flex-shrink-0" />
                </div>
              </Link>
            ))}

            {/* 在途任務卡 */}
            {data && data.inTransitCount > 0 && (
              <Link
                href="/receive"
                className="block rounded-2xl border border-[#EAEAEA] p-4 hover:border-[#171717] transition-colors duration-150 bg-white"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#0070F3]/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg">📦</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#171717]">
                      有 {data.inTransitCount} 單貨在路上
                    </p>
                    <p className="text-xs text-[#8F8F8F] mt-0.5">查看在途集運單</p>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-[#8F8F8F] flex-shrink-0" />
                </div>
              </Link>
            )}

            {/* 盤點提醒（唯讀資訊卡，盤點操作流程排 M2 之後） */}
            {data?.lastStocktakeDays != null && data.lastStocktakeDays >= 14 && (
              <div className="rounded-2xl border border-[#EAEAEA] p-4 bg-[#FAFAFA]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#F5A623]/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg">🕐</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#171717]">
                      上次盤點已過 {data.lastStocktakeDays} 天
                    </p>
                    <p className="text-xs text-[#8F8F8F] mt-0.5">盤點模式尚未上線，先於庫存頁手動核對</p>
                  </div>
                </div>
              </div>
            )}

            {/* 空狀態 */}
            {!hasTasks && (
              <div className="rounded-2xl border border-[#EAEAEA] p-6 text-center bg-white">
                <p className="text-sm text-[#171717] font-medium">今天沒有待辦 👍</p>
              </div>
            )}

            {/* KPI 摘要卡 */}
            {data && (
              <Link
                href="/analytics"
                className="block rounded-2xl border border-[#EAEAEA] p-4 hover:border-[#171717] transition-colors duration-150 bg-white mt-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-[#8F8F8F]">本月摘要</p>
                  <ChevronRightIcon className="w-4 h-4 text-[#8F8F8F]" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-2xl font-semibold text-[#171717] tabular-nums">
                      ${data.kpi.monthRevenue.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-[#8F8F8F] mt-0.5">本月營收（{data.kpi.monthOrders} 筆訂單）</p>
                  </div>
                  <div>
                    <p
                      className={`text-2xl font-semibold tabular-nums ${
                        data.kpi.outOfStock > 0 ? "text-[#E00]" : "text-[#171717]"
                      }`}
                    >
                      {data.kpi.outOfStock}
                    </p>
                    <p className="text-[11px] text-[#8F8F8F] mt-0.5">缺貨（{data.kpi.lowStock} 項低庫存）</p>
                  </div>
                </div>
              </Link>
            )}

            {/* 最近操作 */}
            {data && data.recent.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-medium text-[#8F8F8F] mb-2 px-1">最近操作</p>
                <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] bg-white overflow-hidden">
                  {data.recent.slice(0, 3).map((r) => (
                    <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <p className="text-sm text-[#171717] truncate">{r.text}</p>
                      <p className="text-[11px] text-[#8F8F8F] flex-shrink-0">{r.time}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
