"use client";

// 銷售訂單（PRD §2.3 #09、§5，取代舊 /orders）。訂單列表換皮＋分頁保留（舊頁「1/23」是
// 全站唯一做對分頁的頁，行為對齊即可，這裡改成 load more 樣式與其餘新頁一致）；統計卡金額
// 千分位口徑修正（PRD §5 明點：舊頁「有日期篩選時抓全庫、沒篩選時只算當頁 50 筆」兩套算法
// 混用，同一顆「總營收」數字含義因篩選狀態而變——這裡統一成「永遠對目前搜尋／狀態篩選出的
// 全量做聚合」，不看分頁位置）。訂單識別以「商品名＋日期＋金額」為主，蝦皮訂單編號降為
// metadata（PRD S3：機器識別符當人類介面）。CSV 匯入邏輯原樣搬移，入口降級收進工具區。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { SalesOrder, SalesOrderItem } from "@/lib/database.types";
import { RequireAuth } from "@/components/app/RequireAuth";
import { ChevronRightIcon, SearchIcon } from "@/components/app/icons";

const PAGE_SIZE = 20;

function money(n: number | null | undefined): string {
  return Math.round(Number(n) || 0).toLocaleString();
}

// 分批抓全量：本專案 Supabase db-max-rows=1000，829+ 筆訂單目前在門檻內，但這是會長大的
// 資料（PRD 硬約束），統計卡聚合一律走 range() 迴圈補齊，不因為「現在還沒破千」就走捷徑。
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

type SummaryStats = { totalRevenue: number; totalNet: number; totalFees: number; totalCOGS: number; totalProfit: number; count: number };

// 搜尋（訂單編號／買家）＋狀態篩選共用套用邏輯。PostgrestFilterBuilder 型別鏈很深，
// 用結構化泛型約束會讓 tsc 對 .or()/.eq() 做過深的型別展開（TS2589：excessively deep
// instantiation）；這裡改用未約束泛型＋函式內部單點 any，對外仍是型別安全的 T -> T。
function withOrderFilters<T>(query: T, search: string, status: string): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = query;
  if (search) q = q.or(`order_number.ilike.%${search}%,buyer_name.ilike.%${search}%`);
  if (status !== "全部") q = q.eq("status", status);
  return q as T;
}

export default function SalesPage() {
  return (
    <RequireAuth>
      <SalesPageContent />
    </RequireAuth>
  );
}

function SalesPageContent() {
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("全部");
  const [statusOptions, setStatusOptions] = useState<string[]>([]);

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [itemsByOrder, setItemsByOrder] = useState<Record<number, SalesOrderItem[]>>({});
  const [costByOrder, setCostByOrder] = useState<Record<number, number>>({});
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // 狀態下拉：一次性抓全部訂單的 status 欄位去重（欄位小、829 筆內，非全表其他欄位）
  useEffect(() => {
    (async () => {
      try {
        const rows = await fetchAllRows<{ status: string | null }>((from, to) =>
          getSupabase().from("sales_orders").select("status").range(from, to)
        );
        setStatusOptions(Array.from(new Set(rows.map((r) => r.status).filter((s): s is string => !!s))).sort());
      } catch {
        setStatusOptions([]);
      }
    })();
  }, []);

  const loadPage = useCallback(
    async (reset: boolean) => {
      reset ? setLoading(true) : setLoadingMore(true);
      try {
        const supabase = getSupabase();
        const from = reset ? 0 : offset;
        const query = withOrderFilters(
          supabase.from("sales_orders").select("*", { count: "exact" }).order("order_date", { ascending: false }),
          search,
          status
        ).range(from, from + PAGE_SIZE - 1);
        const { data, error, count } = await query;
        if (error) throw error;
        const rows = data || [];
        setOrders((prev) => (reset ? rows : [...prev, ...rows]));
        setOffset(from + rows.length);
        setTotal(count ?? 0);
        setHasMore(rows.length === PAGE_SIZE);

        if (rows.length > 0) {
          const ids = rows.map((o) => o.id);
          const { data: items } = await supabase
            .from("sales_order_items")
            .select("id, order_id, product_id, product_name, variant_name, qty, unit_price, subtotal")
            .in("order_id", ids);
          const itemsMap: Record<number, SalesOrderItem[]> = {};
          (items || []).forEach((it) => {
            if (!itemsMap[it.order_id]) itemsMap[it.order_id] = [];
            itemsMap[it.order_id].push(it);
          });
          setItemsByOrder((prev) => (reset ? itemsMap : { ...prev, ...itemsMap }));

          const productIds = [...new Set((items || []).map((i) => i.product_id).filter((v): v is number => v != null))];
          const costMap: Record<number, number> = {};
          if (productIds.length > 0) {
            const { data: prods } = await supabase.from("products").select("id, unit_cost_ntd").in("id", productIds);
            (prods || []).forEach((p) => {
              costMap[p.id] = Number(p.unit_cost_ntd) || 0;
            });
          }
          const cogsMap: Record<number, number> = {};
          (items || []).forEach((it) => {
            if (!it.order_id) return;
            const cost = it.product_id ? costMap[it.product_id] || 0 : 0;
            cogsMap[it.order_id] = (cogsMap[it.order_id] || 0) + cost * (Number(it.qty) || 1);
          });
          setCostByOrder((prev) => (reset ? cogsMap : { ...prev, ...cogsMap }));
        } else if (reset) {
          setItemsByOrder({});
          setCostByOrder({});
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : "載入失敗", "error");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [search, status, offset, toast]
  );

  useEffect(() => {
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status]);

  // 統計卡：永遠對目前篩選（search/status）出的全量聚合，不受分頁位置影響（PRD §5 口徑修正）
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const supabase = getSupabase();
      const rows = await fetchAllRows<Pick<SalesOrder, "id" | "order_amount" | "net_revenue">>((from, to) =>
        withOrderFilters(supabase.from("sales_orders").select("id, order_amount, net_revenue"), search, status).range(from, to)
      );
      const totalRevenue = rows.reduce((s, o) => s + (Number(o.order_amount) || 0), 0);
      const totalNet = rows.reduce((s, o) => s + (Number(o.net_revenue) || 0), 0);

      let totalCOGS = 0;
      const ids = rows.map((o) => o.id);
      for (let i = 0; i < ids.length; i += 300) {
        const chunk = ids.slice(i, i + 300);
        const items = await fetchAllRows<{ product_id: number | null; qty: number | null }>((from, to) =>
          supabase.from("sales_order_items").select("product_id, qty").in("order_id", chunk).range(from, to)
        );
        const productIds = [...new Set(items.map((it) => it.product_id).filter((v): v is number => v != null))];
        if (productIds.length === 0) continue;
        const { data: prods } = await supabase.from("products").select("id, unit_cost_ntd").in("id", productIds);
        const costMap = new Map((prods || []).map((p) => [p.id, Number(p.unit_cost_ntd) || 0]));
        totalCOGS += items.reduce((s, it) => s + (it.product_id ? costMap.get(it.product_id) || 0 : 0) * (Number(it.qty) || 1), 0);
      }

      setSummary({ totalRevenue, totalNet, totalFees: totalRevenue - totalNet, totalCOGS, totalProfit: totalNet - totalCOGS, count: rows.length });
    } catch (e) {
      toast(e instanceof Error ? e.message : "統計載入失敗", "error");
    } finally {
      setSummaryLoading(false);
    }
  }, [search, status, toast]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  return (
    <div className="min-h-screen bg-white">
      <header className="px-5 pt-6 pb-3 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">訂單</h1>
        <p className="text-sm text-[#8F8F8F] mt-0.5">共 {total.toLocaleString()} 筆訂單</p>
      </header>

      <main className="px-5 max-w-3xl mx-auto pb-10 space-y-4">
        <div className="relative">
          <SearchIcon className="w-4 h-4 text-[#8F8F8F] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜尋訂單編號、買家..."
            className="w-full pl-10 pr-4 py-3 bg-[#FAFAFA] border border-[#EAEAEA] rounded-xl text-base outline-none focus:border-[#171717] focus:bg-white transition-colors duration-150"
          />
        </div>

        {statusOptions.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {["全部", ...statusOptions].map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`flex-shrink-0 min-h-9 px-3.5 flex items-center justify-center rounded-full border text-xs transition-colors duration-150 ${
                  status === s ? "bg-[#171717] text-white border-[#171717]" : "bg-white text-[#666666] border-[#EAEAEA] hover:border-[#171717]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* 統計卡 */}
        <section className="rounded-2xl border border-[#EAEAEA] p-5">
          {summaryLoading || !summary ? (
            <div className="text-center py-4 text-[#8F8F8F] text-sm">統計計算中...</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xl sm:text-2xl font-semibold text-[#171717] tabular-nums">${money(summary.totalRevenue)}</p>
                  <p className="text-[11px] text-[#8F8F8F] mt-0.5">總營收</p>
                </div>
                <div>
                  <p className="text-xl sm:text-2xl font-semibold text-[#E00] tabular-nums">-${money(Math.abs(summary.totalFees))}</p>
                  <p className="text-[11px] text-[#8F8F8F] mt-0.5">平台費用</p>
                </div>
                <div>
                  <p className="text-xl sm:text-2xl font-semibold text-[#0070F3] tabular-nums">${money(summary.totalNet)}</p>
                  <p className="text-[11px] text-[#8F8F8F] mt-0.5">淨營收</p>
                </div>
                <div>
                  <p className="text-xl sm:text-2xl font-semibold text-[#F5A623] tabular-nums">-${money(summary.totalCOGS)}</p>
                  <p className="text-[11px] text-[#8F8F8F] mt-0.5">商品成本</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-[#EAEAEA] flex items-center justify-between">
                <p className="text-xs text-[#8F8F8F]">淨利潤（{summary.count.toLocaleString()} 筆）</p>
                <p className={`text-lg font-semibold tabular-nums ${summary.totalProfit >= 0 ? "text-[#0CCE6B]" : "text-[#E00]"}`}>
                  ${money(summary.totalProfit)}
                </p>
              </div>
            </>
          )}
        </section>

        {/* 列表 */}
        {loading ? (
          <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
        ) : orders.length === 0 ? (
          <p className="text-center text-sm text-[#8F8F8F] py-12">沒有符合條件的訂單</p>
        ) : (
          <div className="space-y-2 app-fade-up-enter">
            {orders.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                items={itemsByOrder[o.id] || []}
                cogs={costByOrder[o.id] || 0}
                expanded={expandedId === o.id}
                onToggle={() => setExpandedId(expandedId === o.id ? null : o.id)}
              />
            ))}
            {hasMore && (
              <button
                onClick={() => loadPage(false)}
                disabled={loadingMore}
                className="w-full mt-2 py-2.5 text-sm text-[#0070F3] hover:underline disabled:opacity-50"
              >
                {loadingMore ? "載入中..." : `載入更多（已顯示 ${orders.length}／${total}）`}
              </button>
            )}
          </div>
        )}

        {/* 工具區：CSV 匯入（原 /orders 頁一級功能降級） */}
        <div className="pt-4">
          <button onClick={() => setToolsOpen((v) => !v)} className="w-full flex items-center justify-between py-2.5 text-sm text-[#8F8F8F]">
            <span>工具：CSV 匯入蝦皮訂單</span>
            <ChevronRightIcon className={`w-4 h-4 transition-transform duration-150 ${toolsOpen ? "rotate-90" : ""}`} />
          </button>
          {toolsOpen && <ImportTool onImported={() => loadPage(true)} />}
        </div>
      </main>
    </div>
  );
}

function OrderCard({
  order: o,
  items,
  cogs,
  expanded,
  onToggle,
}: {
  order: SalesOrder;
  items: SalesOrderItem[];
  cogs: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const orderAmount = Number(o.order_amount) || 0;
  const netRevenue = Number(o.net_revenue) || 0;
  const profit = netRevenue - cogs;
  const fees = orderAmount - netRevenue;

  const headline = items.length > 0 ? items[0].product_name || "商品" : o.buyer_name || "訂單";
  const extraCount = items.length > 1 ? items.length - 1 : 0;

  return (
    <div className="rounded-2xl border border-[#EAEAEA] p-3.5 cursor-pointer bg-white" onClick={onToggle}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#171717] truncate">
            {headline}
            {extraCount > 0 && <span className="text-[#8F8F8F] font-normal"> 等 {extraCount + 1} 項</span>}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] text-[#8F8F8F]">{o.order_date || "-"}</span>
            {o.buyer_name && <span className="text-[11px] text-[#8F8F8F]">{o.buyer_name}</span>}
            <span className="text-[10px] text-[#8F8F8F] font-mono">{o.order_number}</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold text-[#171717] tabular-nums">${money(orderAmount)}</p>
          <p className={`text-[11px] tabular-nums ${profit >= 0 ? "text-[#0CCE6B]" : "text-[#E00]"}`}>利潤 ${money(profit)}</p>
        </div>
      </div>

      {o.status && (
        <span
          className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full border ${
            o.status.includes("完成")
              ? "bg-[#0CCE6B]/10 text-[#0CCE6B] border-[#0CCE6B]/30"
              : o.status.includes("取消")
              ? "bg-[#E00]/10 text-[#E00] border-[#E00]/30"
              : "bg-[#0070F3]/10 text-[#0070F3] border-[#0070F3]/30"
          }`}
        >
          {o.status}
        </span>
      )}

      {expanded && (
        <div className="mt-3 pt-3 border-t border-[#EAEAEA] space-y-2 text-xs text-[#666666]">
          {items.length > 0 && (
            <div className="space-y-1">
              {items.map((it) => (
                <div key={it.id} className="flex items-center justify-between bg-[#FAFAFA] rounded-lg px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[#171717] truncate">{it.product_name || "未知商品"}</p>
                    {it.variant_name && <p className="text-[#8F8F8F] text-[11px] truncate">{it.variant_name}</p>}
                  </div>
                  <div className="text-[#8F8F8F] flex-shrink-0 ml-2">
                    x{it.qty || 1}
                    {it.unit_price != null && ` · $${money(it.unit_price)}`}
                  </div>
                </div>
              ))}
            </div>
          )}
          <FeeLine label="平台費用小計" value={-fees} />
          <FeeLine label="淨營收" value={netRevenue} highlight="#0070F3" />
          <FeeLine label="商品成本" value={-cogs} highlight="#F5A623" />
          <div className="flex justify-between pt-1 border-t border-[#EAEAEA] font-semibold">
            <span className="text-[#171717]">訂單利潤</span>
            <span className={profit >= 0 ? "text-[#0CCE6B]" : "text-[#E00]"}>${money(profit)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FeeLine({ label, value, highlight }: { label: string; value: number; highlight?: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span style={highlight ? { color: highlight } : undefined} className={!highlight ? (value < 0 ? "text-[#E00]" : "text-[#171717]") : ""}>
        {value < 0 ? "-" : ""}${money(Math.abs(value))}
      </span>
    </div>
  );
}

function parseShopeeCSV(text: string): Partial<SalesOrder>[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const findCol = (keywords: string[]) => headers.findIndex((h) => keywords.some((k) => h.includes(k)));

  const colOrderNo = findCol(["訂單編號", "Order ID", "order_sn"]);
  const colDate = findCol(["訂單成立日期", "Order Creation Date", "create_time"]);
  const colBuyer = findCol(["買家帳號", "Buyer Username", "buyer"]);
  const colAmount = findCol(["訂單金額", "Order Total Amount", "total_amount"]);
  const colStatus = findCol(["訂單狀態", "Order Status", "status"]);
  const colTransactionFee = findCol(["成交手續費", "Transaction Fee"]);
  const colServiceFee = findCol(["服務費", "Service Fee", "活動服務費"]);
  const colPaymentFee = findCol(["金流服務費", "Payment Fee", "金流費"]);
  const colShippingSubsidy = findCol(["免運補助", "Shipping Subsidy"]);
  const colSellerCoupon = findCol(["賣家優惠券", "Seller Voucher"]);
  const colPlatformCoupon = findCol(["蝦皮優惠券", "Shopee Voucher", "平台優惠券"]);

  const results: Partial<SalesOrder>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of lines[i]) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else current += char;
    }
    values.push(current.trim());

    const getVal = (idx: number) => (idx >= 0 && idx < values.length ? values[idx] : "");
    const getNum = (idx: number) => {
      const v = getVal(idx).replace(/[,$]/g, "");
      return v ? Number(v) : null;
    };

    const orderNo = getVal(colOrderNo);
    if (!orderNo) continue;

    results.push({
      order_number: orderNo,
      order_date: getVal(colDate) || null,
      buyer_name: getVal(colBuyer) || null,
      order_amount: getNum(colAmount),
      status: getVal(colStatus) || null,
      transaction_fee: getNum(colTransactionFee),
      payment_processing_fee: getNum(colPaymentFee),
      free_shipping_subsidy: getNum(colShippingSubsidy),
      seller_coupon: getNum(colSellerCoupon),
      platform_coupon: getNum(colPlatformCoupon),
      extended_prep_fee: getNum(colServiceFee),
    });
  }

  return results.map((o) => ({
    ...o,
    net_revenue:
      (o.order_amount || 0) -
      Math.abs(o.transaction_fee || 0) -
      Math.abs(o.payment_processing_fee || 0) -
      Math.abs(o.extended_prep_fee || 0) -
      Math.abs(o.seller_coupon || 0) -
      Math.abs(o.platform_coupon || 0),
  }));
}

function ImportTool({ onImported }: { onImported: () => void }) {
  const { toast } = useToast();
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<Partial<SalesOrder>[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseShopeeCSV(text);
      if (parsed.length === 0) {
        toast("無法解析 CSV，請確認格式是否正確", "error");
        return;
      }
      setPreview(parsed);
    } catch {
      toast("讀取檔案失敗", "error");
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const previewNums = preview.map((o) => o.order_number).filter(Boolean) as string[];
      const { data: existingData } = await getSupabase().from("sales_orders").select("order_number").in("order_number", previewNums);
      const existingNums = new Set((existingData || []).map((o) => o.order_number));
      const newOrders = preview.filter((o) => !existingNums.has(o.order_number || ""));

      if (newOrders.length === 0) {
        toast(`${preview.length} 筆訂單全部已存在，無需匯入`, "info");
        setPreview(null);
        return;
      }

      const { error } = await getSupabase().from("sales_orders").insert(newOrders);
      if (error) throw error;

      toast(`成功匯入 ${newOrders.length} 筆新訂單（跳過 ${preview.length - newOrders.length} 筆重複）`);
      setPreview(null);
      onImported();
    } catch (e) {
      toast(e instanceof Error ? e.message : "匯入失敗", "error");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="mt-2 app-fade-up-enter space-y-3">
      <label className="block w-full py-3 rounded-xl bg-[#FAFAFA] text-[#171717] text-sm font-medium border border-dashed border-[#EAEAEA] text-center cursor-pointer hover:border-[#171717] transition-colors duration-150">
        {importing ? "匯入中..." : "點擊選擇蝦皮訂單 CSV"}
        <input ref={fileRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" disabled={importing} />
      </label>

      {preview && (
        <div className="rounded-xl border border-[#EAEAEA] p-3">
          <p className="text-sm font-medium text-[#171717] mb-2">預覽：解析到 {preview.length} 筆訂單</p>
          <div className="max-h-40 overflow-y-auto space-y-1 mb-3">
            {preview.slice(0, 20).map((o, i) => (
              <div key={i} className="flex justify-between items-center text-xs bg-[#FAFAFA] rounded-lg px-2.5 py-1.5">
                <span className="font-mono">{o.order_number}</span>
                <span className="font-medium">${money(o.order_amount)}</span>
              </div>
            ))}
            {preview.length > 20 && <div className="text-center text-[11px] text-[#8F8F8F] py-1">...還有 {preview.length - 20} 筆</div>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmImport}
              disabled={importing}
              className="flex-1 py-2 rounded-lg bg-[#171717] text-white text-sm font-medium disabled:opacity-50"
            >
              {importing ? "匯入中..." : `確認匯入 ${preview.length} 筆`}
            </button>
            <button
              onClick={() => {
                setPreview(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="flex-1 py-2 rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] text-[#666666] text-sm font-medium"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
