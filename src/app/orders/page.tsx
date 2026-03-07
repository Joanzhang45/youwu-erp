"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { SalesOrder } from "@/lib/database.types";

function exportOrdersCSV(orders: SalesOrder[]) {
  const headers = ["訂單編號","日期","買家","訂單金額","淨營收","狀態","成交手續費","金流服務費","服務費","免運補助","賣家優惠券","平台優惠券"];
  const rows = orders.map(o => [
    o.order_number,
    o.order_date || "",
    o.buyer_name || "",
    o.order_amount ?? 0,
    o.net_revenue ?? 0,
    o.status || "",
    o.transaction_fee ?? 0,
    o.payment_processing_fee ?? 0,
    o.extended_prep_fee ?? 0,
    o.free_shipping_subsidy ?? 0,
    o.seller_coupon ?? 0,
    o.platform_coupon ?? 0,
  ]);
  const BOM = "\uFEFF";
  const csv = BOM + [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `訂單資料_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function OrdersPage() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<Partial<SalesOrder>[] | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [orderCOGS, setOrderCOGS] = useState<Record<number, number>>({});

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      // Get total count
      const { count } = await getSupabase()
        .from("sales_orders")
        .select("*", { count: "exact", head: true });
      setTotalCount(count || 0);

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await getSupabase()
        .from("sales_orders")
        .select("*")
        .order("order_date", { ascending: false })
        .range(from, to);
      if (error) throw error;
      setOrders(data || []);

      // Fetch order items + product costs for COGS calculation
      if (data && data.length > 0) {
        const orderIds = data.map((o) => o.id);
        const { data: items } = await getSupabase()
          .from("sales_order_items")
          .select("order_id, product_id, qty")
          .in("order_id", orderIds);

        if (items && items.length > 0) {
          const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
          const { data: products } = await getSupabase()
            .from("products")
            .select("id, unit_cost_ntd")
            .in("id", productIds);

          const costMap: Record<number, number> = {};
          (products || []).forEach((p) => { costMap[p.id] = Number(p.unit_cost_ntd) || 0; });

          const cogsByOrder: Record<number, number> = {};
          items.forEach((item) => {
            if (!item.order_id) return;
            const cost = item.product_id ? (costMap[item.product_id] || 0) : 0;
            cogsByOrder[item.order_id] = (cogsByOrder[item.order_id] || 0) + cost * (Number(item.qty) || 1);
          });
          setOrderCOGS(cogsByOrder);
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const parseShopeeCSV = (text: string): Partial<SalesOrder>[] => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
    const findCol = (keywords: string[]) =>
      headers.findIndex((h) => keywords.some((k) => h.includes(k)));

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
        else if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; }
        else current += char;
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
      net_revenue: (o.order_amount || 0)
        - Math.abs(o.transaction_fee || 0)
        - Math.abs(o.payment_processing_fee || 0)
        - Math.abs(o.extended_prep_fee || 0)
        + (o.free_shipping_subsidy || 0)
        - Math.abs(o.seller_coupon || 0)
        - Math.abs(o.platform_coupon || 0),
    }));
  };

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
      const existingNums = new Set(orders.map((o) => o.order_number));
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
      fetchOrders();
    } catch (e) {
      toast(e instanceof Error ? e.message : "匯入失敗", "error");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (dateFrom && o.order_date && o.order_date < dateFrom) return false;
      if (dateTo && o.order_date && o.order_date > dateTo) return false;
      return true;
    });
  }, [orders, dateFrom, dateTo]);

  const totalRevenue = filtered.reduce((sum, o) => sum + (Number(o.order_amount) || 0), 0);
  const totalNet = filtered.reduce((sum, o) => sum + (Number(o.net_revenue) || 0), 0);
  const totalFees = totalRevenue - totalNet;
  const totalCOGS = filtered.reduce((sum, o) => sum + (orderCOGS[o.id] || 0), 0);
  const totalProfit = totalNet - totalCOGS;
  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/" className="text-xl">&larr;</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold">銷售訂單</h1>
          <p className="text-xs text-slate-300">
            {hasDateFilter ? `篩選 ${filtered.length} / ${orders.length} 筆` : `共 ${totalCount} 筆訂單（第 ${page + 1}/${totalPages} 頁）`}
          </p>
        </div>
        <button
          onClick={() => exportOrdersCSV(filtered)}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600"
        >
          CSV
        </button>
      </header>

      {/* Import Section */}
      <div className="px-4 py-3 bg-white border-b">
        <label className="block w-full py-3 rounded-xl bg-blue-50 text-blue-700 text-sm font-medium border-2 border-dashed border-blue-300 text-center cursor-pointer hover:bg-blue-100 transition-colors">
          {importing ? "匯入中..." : "點擊匯入蝦皮訂單 CSV"}
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
            disabled={importing}
          />
        </label>
      </div>

      {/* CSV Preview */}
      {preview && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-200">
          <h3 className="text-sm font-bold text-blue-800 mb-2">
            預覽：解析到 {preview.length} 筆訂單
          </h3>
          <div className="max-h-48 overflow-y-auto space-y-1 mb-3">
            {preview.slice(0, 20).map((o, i) => (
              <div key={i} className="bg-white rounded-lg px-3 py-2 text-xs flex justify-between items-center border">
                <div>
                  <span className="font-mono font-medium">{o.order_number}</span>
                  {o.order_date && <span className="text-slate-400 ml-2">{o.order_date}</span>}
                </div>
                <span className="font-medium">${Number(o.order_amount || 0).toLocaleString()}</span>
              </div>
            ))}
            {preview.length > 20 && (
              <div className="text-center text-xs text-slate-400 py-1">
                ...還有 {preview.length - 20} 筆
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmImport}
              disabled={importing}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50"
            >
              {importing ? "匯入中..." : `確認匯入 ${preview.length} 筆`}
            </button>
            <button
              onClick={() => { setPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
              className="flex-1 py-2 rounded-lg bg-slate-200 text-slate-600 text-sm font-medium active:bg-slate-300"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Date Filter */}
      {orders.length > 0 && (
        <div className="px-4 py-2 bg-white border-b">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 flex-shrink-0">日期</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="flex-1 px-2 py-1.5 border rounded text-xs outline-none focus:ring-2 focus:ring-blue-300"
              placeholder="起"
            />
            <span className="text-slate-300">~</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="flex-1 px-2 py-1.5 border rounded text-xs outline-none focus:ring-2 focus:ring-blue-300"
              placeholder="迄"
            />
            {hasDateFilter && (
              <button
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="text-xs text-slate-400 px-2 py-1"
              >
                清除
              </button>
            )}
          </div>
        </div>
      )}

      {/* Summary */}
      {filtered.length > 0 && (
        <div className="px-4 py-3 bg-slate-50 border-b space-y-2">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-[11px] text-slate-400">總營收</div>
              <div className="text-sm font-bold text-slate-800">${totalRevenue.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">平台費用</div>
              <div className="text-sm font-bold text-red-500">-${Math.abs(totalFees).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">淨營收</div>
              <div className="text-sm font-bold text-blue-600">${totalNet.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">商品成本</div>
              <div className="text-sm font-bold text-amber-600">-${totalCOGS.toLocaleString()}</div>
            </div>
          </div>
          <div className="text-center py-1.5 rounded-lg bg-white border">
            <div className="text-[11px] text-slate-400">淨利潤（淨營收 - 商品成本）</div>
            <div className={`text-lg font-bold ${totalProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              ${totalProfit.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Order List */}
      <div className="px-4 py-2">
        {loading ? (
          <div className="text-center py-12 text-slate-400">載入中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-2">
              {orders.length === 0 ? "尚無訂單資料" : "此日期範圍無訂單"}
            </p>
            {orders.length === 0 && (
              <p className="text-xs text-slate-400">從蝦皮後台下載「訂單」CSV 後匯入</p>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {filtered.map((o) => (
                <OrderCard key={o.id} order={o} cogs={orderCOGS[o.id] || 0} />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 py-4">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-xs rounded-lg bg-slate-200 text-slate-600 disabled:opacity-30"
                >
                  上一頁
                </button>
                <span className="text-xs text-slate-500">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 text-xs rounded-lg bg-slate-200 text-slate-600 disabled:opacity-30"
                >
                  下一頁
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OrderCard({ order: o, cogs }: { order: SalesOrder; cogs: number }) {
  const [expanded, setExpanded] = useState(false);
  const fees = Math.abs(Number(o.transaction_fee) || 0)
    + Math.abs(Number(o.payment_processing_fee) || 0)
    + Math.abs(Number(o.extended_prep_fee) || 0)
    + Math.abs(Number(o.seller_coupon) || 0)
    + Math.abs(Number(o.platform_coupon) || 0)
    - (Number(o.free_shipping_subsidy) || 0);

  const orderAmount = Number(o.order_amount) || 0;
  const netRevenue = Number(o.net_revenue) || 0;
  const profit = netRevenue - cogs;
  const marginRate = orderAmount > 0 ? (profit / orderAmount * 100) : 0;

  return (
    <div
      className="bg-white rounded-xl p-3 shadow-sm border border-slate-200 cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium text-sm font-mono">{o.order_number}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            {o.order_date && <span className="text-[11px] text-slate-400">{o.order_date}</span>}
            {o.buyer_name && <span className="text-[11px] text-slate-400">{o.buyer_name}</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-bold">${orderAmount.toLocaleString()}</div>
          <div className={`text-[10px] ${profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            利潤 ${profit.toLocaleString()}
          </div>
          <div className={`text-[10px] ${marginRate >= 20 ? "text-emerald-500" : marginRate >= 0 ? "text-amber-500" : "text-red-500"}`}>
            毛利率 {marginRate.toFixed(1)}%
          </div>
        </div>
      </div>

      {o.status && (
        <span className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full ${
          o.status.includes("完成") || o.status.includes("Completed")
            ? "bg-emerald-100 text-emerald-700"
            : o.status.includes("取消") || o.status.includes("Cancel")
            ? "bg-red-100 text-red-700"
            : "bg-blue-100 text-blue-700"
        }`}>
          {o.status}
        </span>
      )}

      {expanded && (
        <div className="mt-2 pt-2 border-t space-y-1 text-[11px] text-slate-500">
          <FeeRow label="成交手續費" value={o.transaction_fee} negative />
          <FeeRow label="活動/服務費" value={o.extended_prep_fee} negative />
          <FeeRow label="金流服務費" value={o.payment_processing_fee} negative />
          <FeeRow label="免運補助" value={o.free_shipping_subsidy} />
          <FeeRow label="賣家優惠券" value={o.seller_coupon} negative />
          <FeeRow label="平台優惠券" value={o.platform_coupon} negative />
          <div className="flex justify-between pt-1 border-t text-xs font-medium">
            <span className="text-slate-600">平台費用小計</span>
            <span className="text-red-500">-${fees.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-600">商品成本</span>
            <span className="text-amber-600">-${cogs.toLocaleString()}</span>
          </div>
          <div className="flex justify-between pt-1 border-t text-xs font-bold">
            <span className="text-slate-700">訂單毛利</span>
            <span className={profit >= 0 ? "text-emerald-600" : "text-red-500"}>
              ${profit.toLocaleString()} ({marginRate.toFixed(1)}%)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function FeeRow({ label, value, negative }: { label: string; value: number | null; negative?: boolean }) {
  if (!value || value === 0) return null;
  const display = Math.abs(Number(value));
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className={negative ? "text-red-400" : "text-emerald-500"}>
        {negative ? "-" : "+"}${display.toLocaleString()}
      </span>
    </div>
  );
}
