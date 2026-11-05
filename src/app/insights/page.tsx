"use client";

// 新版分析頁（PRD §5、任務②）。舊 src/app/analytics/page.tsx 完全不動，這是全新檔案。
// 資料存取模式沿用舊 analytics 頁：一次抓全量 orders/order_items/products，期間篩選
// 在前端做（見該檔 getPeriodRange/inRange 寫法）；差別是本頁的商品排行「真的」按期間
// 篩選銷量（舊頁的排行榜其實吃全時累計 total_sold_qty，只有頂部 KPI 卡有期間篩選——
// PRD 明確要「本月 Top10/Bottom10」，所以這裡把 qty 改成從當期 order_items 即時加總）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { fetchAllRows, itemUnitCost } from "@/lib/fetchAll";
import { useToast } from "@/components/Toast";
import type { MonthlyProfitability, Product } from "@/lib/database.types";
import { RequireAuth } from "@/components/app/RequireAuth";
import { MonthlyTrendChart } from "@/components/app/MonthlyTrendChart";

type Period = "month" | "lastMonth" | "custom";
type RankTab = "top" | "bottom";
type OrderRow = { id: number; order_date: string | null; is_cancelled: boolean; order_amount: number | null; net_revenue: number | null };
type ItemRow = { order_id: number; product_id: number | null; qty: number | null; subtotal: number | null; unit_cost_at_sale: number | null };
type DatedAmount = { d: string | null; amount: number | null };

type RankedProduct = {
  id: number;
  product_name: string;
  variant_name: string | null;
  product_image: string | null;
  periodQty: number;
  revenue: number;
  totalProfit: number;
  margin: number;
};

type Headline = Omit<MonthlyProfitability, "month">;

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
  if (customFrom && customTo && customFrom <= customTo) return { from: customFrom, to: customTo };
  return null;
}

// 損益與商品排行都用「這段期間實際成立的訂單」算（2026-11-06 第二次健檢 #13）：
// - 營收用訂單實收（net_revenue，已扣蝦皮費用），依品項小計比例分到各商品；
//   訂單沒有實收資料時，退回「品項小計 ×（1 − 平台費率）」估算。
// - 成本用賣出當下的成本快照（unit_cost_at_sale），舊資料沒有快照才用商品目前成本。
// 這樣排行加總 ＝ 上方毛利（扣掉沒對到商品的品項），選自訂區間也是剛好那幾天。
const DEFAULT_FEE_RATE = 12.9;

function sumInRange(rows: DatedAmount[], from: string, to: string): number {
  return rows.reduce((t, r) => (r.d && r.d >= from && r.d <= to ? t + (Number(r.amount) || 0) : t), 0);
}

export default function InsightsPage() {
  return (
    <RequireAuth>
      <InsightsPageContent />
    </RequireAuth>
  );
}

function InsightsPageContent() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [monthly, setMonthly] = useState<MonthlyProfitability[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [ads, setAds] = useState<DatedAmount[]>([]);
  const [expenses, setExpenses] = useState<DatedAmount[]>([]);
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rankTab, setRankTab] = useState<RankTab>("top");
  const [expanded, setExpanded] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const supabase = getSupabase();
      const [monthlyRes, prodRes] = await Promise.all([
        // limit 14（不是 6）：損益卡要跟著「本月／上月／自訂區間」切換，自訂區間可能選到
        // 超過 6 個月前，卡片要有資料可查；趨勢圖仍只取最新 6 個月（見下方 slice(0,6)）。
        supabase
          .from("v_monthly_profitability")
          .select("month, order_count, total_revenue, total_net_revenue, total_cogs, gross_profit, total_ad_cost, total_expenses, net_profit")
          .order("month", { ascending: false })
          .limit(14),
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
      const [ordersData, itemsData, adsData, expData] = await Promise.all([
        fetchAllRows<OrderRow>(() =>
          supabase.from("sales_orders").select("id, order_date, is_cancelled, order_amount, net_revenue").not("order_date", "is", null)
        ),
        fetchAllRows<ItemRow>(() =>
          supabase.from("sales_order_items").select("order_id, product_id, qty, subtotal, unit_cost_at_sale")
        ),
        fetchAllRows<{ ad_date: string | null; amount: number | null }>(() => supabase.from("ad_costs").select("id, ad_date, amount")),
        fetchAllRows<{ expense_date: string | null; amount: number | null }>(() =>
          supabase.from("operating_expenses").select("id, expense_date, amount")
        ),
      ]);
      setOrders(ordersData);
      setItems(itemsData);
      setAds(adsData.map((a) => ({ d: a.ad_date, amount: a.amount })));
      setExpenses(expData.map((e) => ({ d: e.expense_date, amount: e.amount })));
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setExpanded(false);
  }, [period, customFrom, customTo, rankTab]);

  const range = useMemo(() => getPeriodRange(period, customFrom, customTo), [period, customFrom, customTo]);

  const headlineTitle = period === "month" ? "本月損益" : period === "lastMonth" ? "上月損益" : "自訂區間損益";

  const { headline, ranked } = useMemo(() => {
    const zero: Headline = {
      order_count: 0,
      total_revenue: 0,
      total_net_revenue: 0,
      total_cogs: 0,
      gross_profit: 0,
      total_ad_cost: 0,
      total_expenses: 0,
      net_profit: 0,
    };
    if (!range) return { headline: zero, ranked: [] as RankedProduct[] };

    const productMap = new Map(products.map((p) => [p.id, p]));
    const costMap = new Map(products.map((p) => [p.id, Number(p.unit_cost_ntd) || 0]));
    const validOrders = new Map(
      orders
        .filter((o) => !o.is_cancelled && o.order_date && o.order_date >= range.from && o.order_date <= range.to)
        .map((o) => [o.id, o])
    );
    const subtotalByOrder = new Map<number, number>();
    items.forEach((it) => {
      if (validOrders.has(it.order_id)) {
        subtotalByOrder.set(it.order_id, (subtotalByOrder.get(it.order_id) || 0) + (Number(it.subtotal) || 0));
      }
    });

    let cogs = 0;
    const agg = new Map<number, { qty: number; revenue: number; cost: number }>();
    // 還沒結算（沒有實收）的訂單：實收用「品項小計 ×（1 − 平台費率）」估算，損益卡與排行用同一個數
    const estimatedNet = new Map<number, number>();
    items.forEach((it) => {
      const o = validOrders.get(it.order_id);
      if (!o) return;
      const qty = Number(it.qty) || 0;
      const sub = Number(it.subtotal) || 0;
      const orderSub = subtotalByOrder.get(it.order_id) || 0;
      const p = it.product_id != null ? productMap.get(it.product_id) : undefined;
      const settled = o.net_revenue != null && orderSub > 0;
      const revenue = settled
        ? (Number(o.net_revenue) * sub) / orderSub
        : sub * (1 - (Number(p?.platform_fee_rate) || DEFAULT_FEE_RATE) / 100);
      if (!settled) estimatedNet.set(o.id, (estimatedNet.get(o.id) || 0) + revenue);
      if (it.product_id == null) return;
      const cost = qty * itemUnitCost(it, costMap);
      cogs += cost;
      const a = agg.get(it.product_id) || { qty: 0, revenue: 0, cost: 0 };
      a.qty += qty;
      a.revenue += revenue;
      a.cost += cost;
      agg.set(it.product_id, a);
    });

    let revenueSum = 0;
    let netSum = 0;
    validOrders.forEach((o) => {
      revenueSum += Number(o.order_amount) || 0;
      netSum += o.net_revenue != null && (subtotalByOrder.get(o.id) || 0) > 0 ? Number(o.net_revenue) : estimatedNet.get(o.id) ?? (Number(o.net_revenue) || 0);
    });
    const ad = sumInRange(ads, range.from, range.to);
    const exp = sumInRange(expenses, range.from, range.to);
    const headline: Headline = {
      order_count: validOrders.size,
      total_revenue: revenueSum,
      total_net_revenue: netSum,
      total_cogs: cogs,
      gross_profit: netSum - cogs,
      total_ad_cost: ad,
      total_expenses: exp,
      net_profit: netSum - cogs - ad - exp,
    };

    const ranked: RankedProduct[] = [];
    agg.forEach((a, id) => {
      const p = productMap.get(id);
      if (!p || a.qty <= 0) return;
      const profit = a.revenue - a.cost;
      ranked.push({
        id,
        product_name: p.product_name,
        variant_name: p.variant_name,
        product_image: p.product_image,
        periodQty: a.qty,
        revenue: a.revenue,
        totalProfit: profit,
        margin: a.revenue > 0 ? profit / a.revenue : 0,
      });
    });
    return { headline, ranked };
  }, [range, products, orders, items, ads, expenses]);

  const activeList = useMemo(() => {
    const sorted = [...ranked].sort((a, b) => (rankTab === "top" ? b.totalProfit - a.totalProfit : a.totalProfit - b.totalProfit));
    return sorted;
  }, [ranked, rankTab]);

  const displayList = expanded ? activeList : activeList.slice(0, 10);

  return (
    <div className="min-h-screen bg-white">
      <header className="px-5 pt-6 pb-4 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">分析</h1>
        <p className="text-sm text-[#8F8F8F] mt-0.5">這個月賺不賺、該補什麼</p>
      </header>

      <main className="px-5 max-w-3xl mx-auto pb-10">
        {loading ? (
          <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
        ) : (
          <div className="space-y-5 app-fade-up-enter">
            {/* 期間篩選：搬到最上面、脫離「商品排行」卡——這是整頁共用的期間控制（同時
                驅動下面損益卡＋商品排行），原本塞在商品排行卡內容易讓人誤以為只影響排行榜
                （tester 2026-07-12 blocker：切期間損益卡沒反應，根因是資料沒接，這裡順手把
                UI 層級也理順，不然邏輯修好了但位置還是看起來像只管排行榜）。
                按鈕 min-h-11(44px) 是觸控熱區下限（design-taste 規範），原本 py-1.5 量到只有
                ~33px，順手補齊。 */}
            <div className="flex flex-wrap items-center gap-2">
              {([
                { key: "month" as const, label: "本月" },
                { key: "lastMonth" as const, label: "上月" },
                { key: "custom" as const, label: "自訂" },
              ]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setPeriod(t.key)}
                  className={`min-h-11 px-4 flex items-center justify-center rounded-full border text-xs transition-colors duration-150 ${
                    period === t.key
                      ? "bg-[#171717] text-white border-[#171717]"
                      : "bg-white text-[#666666] border-[#EAEAEA] hover:border-[#171717]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
              {period === "custom" && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="min-h-11 px-2 border border-[#EAEAEA] rounded-lg outline-none focus:border-[#171717] text-xs"
                  />
                  <span className="text-[#8F8F8F] text-xs">至</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="min-h-11 px-2 border border-[#EAEAEA] rounded-lg outline-none focus:border-[#171717] text-xs"
                  />
                </div>
              )}
            </div>

            {/* 損益卡（A9：桌機 1280 首屏含本月營收／毛利，金額全千分位）——標題與數字
                跟著上面「期間篩選」pills 走，見 headline useMemo */}
            <section className="rounded-2xl border border-[#EAEAEA] p-5">
              <p className="text-xs font-medium text-[#8F8F8F] mb-3">
                {headlineTitle}
                {range && <span className="ml-1.5 text-[#B0B0B0]">{range.from.slice(5).replace("-", "/")}～{range.to.slice(5).replace("-", "/")}</span>}
              </p>
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

            {/* 月度趨勢（固定近 6 個月，不受上面期間篩選影響——見 PRD §5「月度趨勢」與
                「商品排行期間篩選」是兩個獨立需求；損益卡與排行改用原始訂單即時算，這裡只切最新 6 個月畫圖） */}
            <section className="rounded-2xl border border-[#EAEAEA] p-5">
              <p className="text-xs font-medium text-[#8F8F8F] mb-3">近 6 個月營收／淨利</p>
              <MonthlyTrendChart data={monthly.slice(0, 6)} />
            </section>

            {/* 商品排行（沿用上面同一組期間篩選 state，只多一個 Top/Bottom 切換） */}
            <section className="rounded-2xl border border-[#EAEAEA] p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-medium text-[#8F8F8F]">商品排行</p>
                <div className="flex gap-1 bg-[#FAFAFA] p-0.5 rounded-lg border border-[#EAEAEA]">
                  {([
                    { key: "top" as const, label: "Top 10" },
                    { key: "bottom" as const, label: "Bottom 10" },
                  ]).map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setRankTab(t.key)}
                      className={`min-h-11 px-3 flex items-center justify-center rounded-md text-xs transition-colors duration-150 ${
                        rankTab === t.key ? "bg-white text-[#171717] font-medium shadow-sm" : "text-[#8F8F8F]"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
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
