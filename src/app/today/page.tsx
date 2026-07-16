"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import type { ConsolidatedShipment } from "@/lib/database.types";
import { isStockAlertEligible } from "@/lib/productStatus";
import { RequireAuth } from "@/components/app/RequireAuth";
import { ReceiveIcon, ChevronRightIcon } from "@/components/app/icons";

type ArrivedTask = { shipment: ConsolidatedShipment; itemCount: number };
type ActivityRow = { id: number; text: string; time: string };

type TodayData = {
  arrived: ArrivedTask[];
  inTransitCount: number;
  lastStocktakeDays: number | null;
  kpi: {
    monthRevenue: number;
    monthOrders: number;
    monthGrossProfit: number;
    monthNetProfit: number;
    outOfStock: number;
    lowStock: number;
  };
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
  return (
    <RequireAuth>
      <TodayPageContent />
    </RequireAuth>
  );
}

function TodayPageContent() {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const supabase = getSupabase();
      const [shipRes, stockRes, monthRes, snapshotRes, ledgerRes] = await Promise.all([
        supabase
          .from("consolidated_shipments")
          .select("*")
          .in("status", ["準備中", "已出發", "運送中", "已到達"])
          .order("expected_arrival", { ascending: true }),
        // 缺貨/低庫存警示計數口徑：改成前端就地算（排除非在售品項），不動 v_dashboard_kpi
        // 這顆 DB view（後端零動，2026-07-16 spec-外決定）。改讀 v_products_with_stock
        // （既有 view，/stock /catalog 已在用）拿 product_status/stock_qty/safety_stock。
        supabase.from("v_products_with_stock").select("product_status, stock_qty, safety_stock"),
        // M4：改讀 v_monthly_profitability（010/011），一次拿到營收＋毛利＋淨利，
        // 取代舊的 v_monthly_revenue（只有營收沒有毛利，M2 已知缺口，見 PRD §7.1）
        supabase
          .from("v_monthly_profitability")
          .select("month, order_count, total_net_revenue, gross_profit, net_profit")
          .order("month", { ascending: false })
          .limit(3),
        supabase.from("stock_snapshots").select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1),
        supabase.from("inventory_ledger").select("id, product_id, movement_type, qty_delta, note, occurred_at").order("occurred_at", { ascending: false }).limit(5),
      ]);

      // 排除停售/測品/季節款等非在售品項，只計「需要行動」的常駐/主力款缺貨與低庫存
      // （2026-07-16：93 項缺貨含 16+ 項雜訊，彣錩/Joan 反映警示數字失真）
      const alertEligible = (stockRes.data || []).filter((p) => isStockAlertEligible(p.product_status));
      const outOfStockCount = alertEligible.filter((p) => (p.stock_qty || 0) <= 0).length;
      const lowStockCount = alertEligible.filter(
        (p) => (p.stock_qty || 0) > 0 && p.safety_stock != null && p.stock_qty <= p.safety_stock
      ).length;

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

      // v_monthly_profitability.month 是 date_trunc('month', ...)::date，Postgrest 回傳
      // "YYYY-MM-01"（不是 v_monthly_revenue 舊格式的 "YYYY-MM"），比對格式要跟著換。
      const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
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
          // v_monthly_profitability 的毛利/淨利欄位是 numeric 除法算出來的浮點數，
          // 四捨五入到整數元再存，不然 .toLocaleString() 會噴出「$2,637.71」這種雜訊
          // （2026-07-12 自測用真實登入態截圖抓到，同一顆 bug 也修在 /insights）
          monthRevenue: Math.round(Number(monthRow?.total_net_revenue) || 0),
          monthOrders: Number(monthRow?.order_count) || 0,
          monthGrossProfit: Math.round(Number(monthRow?.gross_profit) || 0),
          monthNetProfit: Math.round(Number(monthRow?.net_profit) || 0),
          outOfStock: outOfStockCount,
          lowStock: lowStockCount,
        },
        recent,
      });
    } catch {
      setData({
        arrived: [],
        inTransitCount: 0,
        lastStocktakeDays: null,
        kpi: { monthRevenue: 0, monthOrders: 0, monthGrossProfit: 0, monthNetProfit: 0, outOfStock: 0, lowStock: 0 },
        recent: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const today = new Date();
  const weekday = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"][today.getDay()];
  const dateLabel = `${today.getMonth() + 1}月${today.getDate()}日 ${weekday}`;

  // 盤點提醒：從沒盤過（lastStocktakeDays === null）或已過 14 天以上都算「待辦」，
  // 併入 hasTasks 判斷——不然「今天沒有待辦 👍」空狀態文案會跟緊接在它下面的盤點提醒卡互相矛盾
  // （M4 sub-batch 3b 修正；原本只看 arrived/inTransitCount 兩項，盤點卡自己不影響空狀態判斷）。
  const showStocktakeReminder = !loading && !!data && (data.lastStocktakeDays == null || data.lastStocktakeDays >= 14);
  const hasTasks = !loading && data && (data.arrived.length > 0 || data.inTransitCount > 0 || showStocktakeReminder);

  return (
    <div className="min-h-screen bg-white">
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

            {/* 盤點提醒（M4 sub-batch 3b：盤點模式已上線，改成可點的任務卡）
                從沒盤過（lastStocktakeDays === null，stock_snapshots 空表）引導首次盤點；
                已過 14 天以上則提醒該盤了。兩種文案共用同一個入口 /stock?stocktake=1。 */}
            {showStocktakeReminder && (
              <Link
                href="/stock?stocktake=1"
                className="block rounded-2xl border border-[#EAEAEA] p-4 hover:border-[#171717] transition-colors duration-150 bg-[#FAFAFA]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#F5A623]/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg">🕐</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#171717]">
                      {data?.lastStocktakeDays == null ? "還沒盤點過" : `上次盤點已過 ${data.lastStocktakeDays} 天`}
                    </p>
                    <p className="text-xs text-[#8F8F8F] mt-0.5">
                      {data?.lastStocktakeDays == null ? "點我開始第一次盤點" : "點我開始盤點"}
                    </p>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-[#8F8F8F] flex-shrink-0" />
                </div>
              </Link>
            )}

            {/* 空狀態 */}
            {!hasTasks && (
              <div className="rounded-2xl border border-[#EAEAEA] p-6 text-center bg-white">
                <p className="text-sm text-[#171717] font-medium">今天沒有待辦 👍</p>
              </div>
            )}

            {/* KPI 摘要卡（M4：補本月毛利／淨利，關閉 M2 已知缺口，見 PRD §7.1） */}
            {data && (
              <Link
                href="/insights"
                className="block rounded-2xl border border-[#EAEAEA] p-4 hover:border-[#171717] transition-colors duration-150 bg-white mt-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-[#8F8F8F]">本月摘要</p>
                  <ChevronRightIcon className="w-4 h-4 text-[#8F8F8F]" />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <div>
                    <p className="text-2xl font-semibold text-[#171717] tabular-nums">
                      ${data.kpi.monthRevenue.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-[#8F8F8F] mt-0.5">本月營收（{data.kpi.monthOrders} 筆訂單）</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-[#171717] tabular-nums">
                      ${data.kpi.monthGrossProfit.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-[#8F8F8F] mt-0.5">本月毛利</p>
                  </div>
                  <div>
                    <p
                      className={`text-2xl font-semibold tabular-nums ${
                        data.kpi.monthNetProfit < 0 ? "text-[#E00]" : "text-[#171717]"
                      }`}
                    >
                      ${data.kpi.monthNetProfit.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-[#8F8F8F] mt-0.5">本月淨利</p>
                  </div>
                  <div>
                    {/* 附帶 2 修復（tester 2026-07-12）：舊寫法「125（1 項低庫存）」把缺貨/低庫存
                        兩個不同指標用括號嵌在一起，讀起來像同一件事的附註，量級差 100 倍時特別
                        突兀。改成大數字直接標單位＋用 · 並列第二個獨立指標，兩者視覺對等、語意
                        分開。數字源改為前端就地算（見上方 fetchData，2026-07-16 排除非在售品項）。 */}
                    <p
                      className={`text-2xl font-semibold tabular-nums ${
                        data.kpi.outOfStock > 0 ? "text-[#E00]" : "text-[#171717]"
                      }`}
                    >
                      {data.kpi.outOfStock}
                    </p>
                    <p className="text-[11px] text-[#8F8F8F] mt-0.5">項缺貨 · {data.kpi.lowStock} 項低庫存</p>
                  </div>
                </div>
                <p className="text-[10px] text-[#8F8F8F] mt-3">不含停售/測品/季節款</p>
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

            {/* 低調的使用說明入口——彣錩第一次看新版反映找不到按鈕，這頁是為他寫的白話說明書 */}
            <p className="text-center pt-4">
              <Link href="/help" className="text-xs text-[#8F8F8F] hover:text-[#171717] transition-colors duration-150">
                ❓ 不會用？看使用說明
              </Link>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
