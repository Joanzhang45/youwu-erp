"use client";

// 新版分析頁（PRD §5、任務②）。舊 src/app/analytics/page.tsx 完全不動，這是全新檔案。
// 資料存取模式沿用舊 analytics 頁：一次抓全量 orders/order_items/products，期間篩選
// 在前端做（見該檔 getPeriodRange/inRange 寫法）；差別是本頁的商品排行「真的」按期間
// 篩選銷量（舊頁的排行榜其實吃全時累計 total_sold_qty，只有頂部 KPI 卡有期間篩選——
// PRD 明確要「本月 Top10/Bottom10」，所以這裡把 qty 改成從當期 order_items 即時加總）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/Toast";
import type { MonthlyProfitability, Product } from "@/lib/database.types";
import { DEMO_MONTHLY_PROFITABILITY } from "@/lib/demo-data-app";
import { DEMO_PRODUCTS } from "@/lib/demo-data";
import { MonthlyTrendChart } from "@/components/app/MonthlyTrendChart";

type Period = "month" | "lastMonth" | "custom";
type RankTab = "top" | "bottom";
type OrderRow = { id: number; order_date: string | null; status: string | null };
type ItemRow = { order_id: number; product_id: number | null; qty: number | null };

type RankedProduct = {
  id: number;
  product_name: string;
  variant_name: string | null;
  product_image: string | null;
  periodQty: number;
  unitProfit: number;
  totalProfit: number;
  margin: number;
};

// 分頁抓全量：本專案 Supabase db-max-rows=1000，單次 select 對 >1000 列的表會被
// 伺服器靜默截斷（見 fetchData 內註解），這支 helper 用 .range() 迴圈補齊。
async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await makeQuery(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

// v_monthly_profitability 的金額欄位是 numeric 除法算出來的浮點數（例：2637.7097），
// 直接 .toLocaleString() 預設最多顯示 3 位小數會噴出「$2,637.71」這種雜訊——2026-07-12
// 自測用真實登入態截圖才抓到，先四捨五入到整數元再千分位，全站金額規範本就是整數元。
function fmtMoney(n: number): string {
  return Math.round(n).toLocaleString();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthBoundaries(year: number, month0: number) {
  return {
    from: toDateStr(new Date(year, month0, 1)),
    to: toDateStr(new Date(year, month0 + 1, 0)),
  };
}

function getPeriodRange(period: Period, customFrom: string, customTo: string): { from: string; to: string } | null {
  const now = new Date();
  if (period === "month") {
    return { from: monthBoundaries(now.getFullYear(), now.getMonth()).from, to: toDateStr(now) };
  }
  if (period === "lastMonth") {
    const m = now.getMonth() - 1;
    const y = m < 0 ? now.getFullYear() - 1 : now.getFullYear();
    return monthBoundaries(y, ((m % 12) + 12) % 12);
  }
  if (customFrom && customTo) return { from: customFrom, to: customTo };
  return null;
}

// 與舊 analytics 頁同公式（該檔 line 167：fees = revenue * (feeRate/100)），沿用不修正——
// platform_fee_rate 的儲存單位（百分比數字 vs 小數）不在本次任務範圍內判定對錯。
function buildRanked(p: Product, periodQty: number): RankedProduct {
  const revenue = Number(p.selling_price) || 0;
  const cost = Number(p.unit_cost_ntd) || 0;
  const feeRate = Number(p.platform_fee_rate) || 0;
  const fees = revenue * (feeRate / 100);
  const unitProfit = revenue - cost - fees;
  const margin = revenue > 0 ? unitProfit / revenue : 0;
  return {
    id: p.id,
    product_name: p.product_name,
    variant_name: p.variant_name,
    product_image: p.product_image,
    periodQty,
    unitProfit,
    totalProfit: unitProfit * periodQty,
    margin,
  };
}

export default function InsightsPage() {
  const { isDemo } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [monthly, setMonthly] = useState<MonthlyProfitability[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rankTab, setRankTab] = useState<RankTab>("top");
  const [expanded, setExpanded] = useState(false);

  const fetchData = useCallback(async () => {
    if (isDemo) {
      setMonthly(DEMO_MONTHLY_PROFITABILITY);
      setProducts(DEMO_PRODUCTS);
      setOrders([]);
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const supabase = getSupabase();
      const [monthlyRes, prodRes] = await Promise.all([
        supabase
          .from("v_monthly_profitability")
          .select("month, order_count, total_revenue, total_net_revenue, total_cogs, gross_profit, total_ad_cost, total_expenses, net_profit")
          .order("month", { ascending: false })
          .limit(6),
        supabase
          .from("products")
          .select("id, product_name, variant_name, product_image, selling_price, unit_cost_ntd, platform_fee_rate, product_status")
          .order("product_name"),
      ]);
      if (monthlyRes.error) throw monthlyRes.error;
      if (prodRes.error) throw prodRes.error;
      setMonthly(monthlyRes.data || []);
      setProducts((prodRes.data as Product[]) || []);

      // sales_orders（1,110 列）與 sales_order_items（2,173 列）都超過本專案 Supabase
      // db-max-rows=1000 的伺服器端硬上限（2026-07-12 自測 curl 實測：不加 range 的
      // select 只回 Content-Range 0-999/2173，即使 client 端 .limit() 設更大也一樣被
      // 伺服器夾住）。單次 select 會靜默截斷、且截到的是哪一段由 PostgREST 預設排序
      // 決定、不保證含最新列——這正是「本月排行榜」一度全空的根因：本月訂單剛好落在
      // 被截掉的那段。分頁抓好全量再篩期間，不能只加大 limit。
      const [ordersData, itemsData] = await Promise.all([
        fetchAllRows<OrderRow>((from, to) =>
          supabase.from("sales_orders").select("id, order_date, status").not("order_date", "is", null).range(from, to)
        ),
        fetchAllRows<ItemRow>((from, to) =>
          supabase.from("sales_order_items").select("order_id, product_id, qty").range(from, to)
        ),
      ]);
      setOrders(ordersData);
      setItems(itemsData);
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, [isDemo, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setExpanded(false);
  }, [period, customFrom, customTo, rankTab]);

  const now = new Date();
  const thisMonthStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  // 誠實顯示：本月若還沒有任何訂單/廣告/費用列，v_monthly_profitability 不會有這一列，
  // 落到 0 而不是偷用上個月數字冒充（同 /today 既有寫法）
  const headline = monthly.find((m) => m.month === thisMonthStr) ?? {
    month: thisMonthStr,
    order_count: 0,
    total_revenue: 0,
    total_net_revenue: 0,
    total_cogs: 0,
    gross_profit: 0,
    total_ad_cost: 0,
    total_expenses: 0,
    net_profit: 0,
  };

  const range = useMemo(() => getPeriodRange(period, customFrom, customTo), [period, customFrom, customTo]);

  const ranked = useMemo(() => {
    const eligible = products.filter((p) => p.selling_price && p.selling_price > 0 && p.product_status !== "停售");
    if (isDemo) {
      // demo 沒有逐筆訂單可依期間篩選，用商品全時已售數量近似（僅展示用途，期間切換
      // 視覺可互動但數字不變——這是刻意簡化，見交付報告偏離說明）
      return eligible.map((p) => buildRanked(p, p.total_sold_qty || 0));
    }
    if (!range) return [];
    const validOrderIds = new Set(
      orders
        .filter((o) => o.status !== "不成立" && o.order_date && o.order_date >= range.from && o.order_date <= range.to)
        .map((o) => o.id)
    );
    const qtyByProduct = new Map<number, number>();
    items.forEach((it) => {
      if (it.product_id != null && validOrderIds.has(it.order_id)) {
        qtyByProduct.set(it.product_id, (qtyByProduct.get(it.product_id) || 0) + (it.qty || 0));
      }
    });
    return eligible.map((p) => buildRanked(p, qtyByProduct.get(p.id) || 0)).filter((r) => r.periodQty > 0);
  }, [isDemo, products, orders, items, range]);

  const activeList = useMemo(() => {
    const sorted = [...ranked].sort((a, b) => (rankTab === "top" ? b.totalProfit - a.totalProfit : a.totalProfit - b.totalProfit));
    return sorted;
  }, [ranked, rankTab]);

  const displayList = expanded ? activeList : activeList.slice(0, 10);

  return (
    <div className="min-h-screen bg-white">
      {isDemo && (
        <div className="bg-[#F5A623] text-[#171717] text-xs text-center py-1 font-medium">
          展示模式 — 資料為模擬
        </div>
      )}

      <header className="px-5 pt-6 pb-4 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">分析</h1>
        <p className="text-sm text-[#8F8F8F] mt-0.5">這個月賺不賺、該補什麼</p>
      </header>

      <main className="px-5 max-w-3xl mx-auto pb-10">
        {loading ? (
          <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
        ) : (
          <div className="space-y-5 app-fade-up-enter">
            {/* 本月損益卡（A9：桌機 1280 首屏含本月營收／毛利，金額全千分位） */}
            <section className="rounded-2xl border border-[#EAEAEA] p-5">
              <p className="text-xs font-medium text-[#8F8F8F] mb-3">本月損益</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-2xl sm:text-3xl font-semibold text-[#171717] tabular-nums">
                    ${fmtMoney(headline.total_net_revenue)}
                  </p>
                  <p className="text-[11px] text-[#8F8F8F] mt-0.5">營收（{headline.order_count} 筆訂單）</p>
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-semibold text-[#171717] tabular-nums">
                    ${fmtMoney(headline.gross_profit)}
                  </p>
                  <p className="text-[11px] text-[#8F8F8F] mt-0.5">毛利</p>
                </div>
                <div>
                  <p
                    className={`text-2xl sm:text-3xl font-semibold tabular-nums ${
                      headline.net_profit < 0 ? "text-[#E00]" : "text-[#171717]"
                    }`}
                  >
                    ${fmtMoney(headline.net_profit)}
                  </p>
                  <p className="text-[11px] text-[#8F8F8F] mt-0.5">淨利</p>
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-semibold text-[#171717] tabular-nums">
                    {headline.order_count.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-[#8F8F8F] mt-0.5">訂單數</p>
                </div>
              </div>
            </section>

            {/* 月度趨勢 */}
            <section className="rounded-2xl border border-[#EAEAEA] p-5">
              <p className="text-xs font-medium text-[#8F8F8F] mb-3">近 6 個月營收／淨利</p>
              <MonthlyTrendChart data={monthly} />
            </section>

            {/* 商品排行 */}
            <section className="rounded-2xl border border-[#EAEAEA] p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-[#8F8F8F]">商品排行</p>
                <div className="flex gap-1 bg-[#FAFAFA] p-0.5 rounded-lg border border-[#EAEAEA]">
                  {([
                    { key: "top" as const, label: "Top 10" },
                    { key: "bottom" as const, label: "Bottom 10" },
                  ]).map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setRankTab(t.key)}
                      className={`text-xs px-2.5 py-1 rounded-md transition-colors duration-150 ${
                        rankTab === t.key ? "bg-white text-[#171717] font-medium shadow-sm" : "text-[#8F8F8F]"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 期間篩選 */}
              <div className="flex flex-wrap items-center gap-1.5 mb-4">
                {([
                  { key: "month" as const, label: "本月" },
                  { key: "lastMonth" as const, label: "上月" },
                  { key: "custom" as const, label: "自訂" },
                ]).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setPeriod(t.key)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors duration-150 ${
                      period === t.key
                        ? "bg-[#171717] text-white border-[#171717]"
                        : "bg-white text-[#666666] border-[#EAEAEA] hover:border-[#171717]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
                {period === "custom" && (
                  <div className="flex items-center gap-1.5 ml-1">
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="text-xs px-2 py-1.5 border border-[#EAEAEA] rounded-lg outline-none focus:border-[#171717]"
                    />
                    <span className="text-[#8F8F8F] text-xs">至</span>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="text-xs px-2 py-1.5 border border-[#EAEAEA] rounded-lg outline-none focus:border-[#171717]"
                    />
                  </div>
                )}
              </div>

              {period === "custom" && (!customFrom || !customTo) ? (
                <p className="text-center text-sm text-[#8F8F8F] py-8">請選擇起訖日期</p>
              ) : displayList.length === 0 ? (
                <p className="text-center text-sm text-[#8F8F8F] py-8">本期尚無出貨紀錄</p>
              ) : (
                <>
                  <div className="rounded-xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
                    {displayList.map((r, idx) => {
                      const isLoss = r.totalProfit < 0;
                      return (
                        <div key={r.id} className="px-3.5 py-3 flex items-center gap-3">
                          <span className="w-5 text-xs text-[#8F8F8F] tabular-nums flex-shrink-0">{idx + 1}</span>
                          {r.product_image ? (
                            <img
                              src={r.product_image}
                              alt={r.product_name}
                              className="w-10 h-10 rounded-lg object-cover bg-[#FAFAFA] flex-shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-[#FAFAFA] flex items-center justify-center flex-shrink-0 text-base">
                              📦
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#171717] truncate">{r.product_name}</p>
                            <div className="flex items-center gap-2">
                              {r.variant_name && <p className="text-xs text-[#8F8F8F] truncate">{r.variant_name}</p>}
                              <span className="text-[11px] text-[#8F8F8F] tabular-nums flex-shrink-0">已售 {r.periodQty}</span>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-sm font-semibold tabular-nums ${isLoss ? "text-[#E00]" : "text-[#171717]"}`}>
                              ${Math.round(r.totalProfit).toLocaleString()}
                            </p>
                            <p className="text-[11px] text-[#8F8F8F] tabular-nums">{(r.margin * 100).toFixed(0)}% 毛利率</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {activeList.length > 10 && (
                    <button
                      onClick={() => setExpanded((v) => !v)}
                      className="w-full mt-3 py-2.5 text-sm text-[#0070F3] hover:underline"
                    >
                      {expanded ? "收合" : `展開全部（共 ${activeList.length} 項）`}
                    </button>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
