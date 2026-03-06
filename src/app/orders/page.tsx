"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import type { SalesOrder } from "@/lib/database.types";

export default function OrdersPage() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await getSupabase()
        .from("sales_orders")
        .select("*")
        .order("order_date", { ascending: false });
      if (error) throw error;
      setOrders(data || []);
    } catch (e) {
      alert(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const parseShopeeCSV = (text: string): Partial<SalesOrder>[] => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    // Parse header - Shopee CSV uses various column names
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
      // Handle CSV with quoted fields
      const values: string[] = [];
      let current = "";
      let inQuotes = false;
      for (const char of lines[i]) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          values.push(current.trim());
          current = "";
        } else {
          current += char;
        }
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

    // Calculate net_revenue for each order
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

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const parsed = parseShopeeCSV(text);
      if (parsed.length === 0) {
        setImportResult("無法解析 CSV，請確認格式是否正確");
        return;
      }

      // Check for duplicates
      const existingNums = new Set(orders.map((o) => o.order_number));
      const newOrders = parsed.filter((o) => !existingNums.has(o.order_number || ""));

      if (newOrders.length === 0) {
        setImportResult(`解析 ${parsed.length} 筆訂單，全部已存在，無需匯入`);
        return;
      }

      const { error } = await getSupabase()
        .from("sales_orders")
        .insert(newOrders);
      if (error) throw error;

      setImportResult(`成功匯入 ${newOrders.length} 筆新訂單（跳過 ${parsed.length - newOrders.length} 筆重複）`);
      fetchOrders();
    } catch (e) {
      setImportResult(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.order_amount) || 0), 0);
  const totalNet = orders.reduce((sum, o) => sum + (Number(o.net_revenue) || 0), 0);
  const totalFees = totalRevenue - totalNet;

  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/" className="text-xl">&larr;</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold">銷售訂單</h1>
          <p className="text-xs text-slate-300">共 {orders.length} 筆訂單</p>
        </div>
      </header>

      {/* Import Section */}
      <div className="px-4 py-3 bg-white border-b">
        <label className="block w-full py-3 rounded-xl bg-blue-50 text-blue-700 text-sm font-medium border-2 border-dashed border-blue-300 text-center cursor-pointer hover:bg-blue-100 transition-colors">
          {importing ? "匯入中..." : "拖曳或點擊匯入蝦皮訂單 CSV"}
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleImport}
            className="hidden"
            disabled={importing}
          />
        </label>
        {importResult && (
          <p className={`text-xs mt-2 text-center ${importResult.includes("成功") ? "text-emerald-600" : "text-amber-600"}`}>
            {importResult}
          </p>
        )}
      </div>

      {/* Summary */}
      {orders.length > 0 && (
        <div className="px-4 py-3 bg-slate-50 border-b">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[11px] text-slate-400">總營收</div>
              <div className="text-sm font-bold text-slate-800">${totalRevenue.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">總費用</div>
              <div className="text-sm font-bold text-red-500">-${Math.abs(totalFees).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">淨營收</div>
              <div className="text-sm font-bold text-emerald-600">${totalNet.toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}

      {/* Order List */}
      <div className="px-4 py-2">
        {loading ? (
          <div className="text-center py-12 text-slate-400">載入中...</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-2">尚無訂單資料</p>
            <p className="text-xs text-slate-400">從蝦皮後台下載「訂單」CSV 後匯入</p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OrderCard({ order: o }: { order: SalesOrder }) {
  const [expanded, setExpanded] = useState(false);
  const fees = Math.abs(Number(o.transaction_fee) || 0)
    + Math.abs(Number(o.payment_processing_fee) || 0)
    + Math.abs(Number(o.extended_prep_fee) || 0)
    + Math.abs(Number(o.seller_coupon) || 0)
    + Math.abs(Number(o.platform_coupon) || 0)
    - (Number(o.free_shipping_subsidy) || 0);

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
          <div className="text-sm font-bold">${Number(o.order_amount || 0).toLocaleString()}</div>
          <div className="text-[10px] text-emerald-600">
            淨 ${Number(o.net_revenue || 0).toLocaleString()}
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
            <span className="text-slate-600">總扣款</span>
            <span className="text-red-500">-${fees.toLocaleString()}</span>
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
