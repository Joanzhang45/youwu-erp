"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { Product } from "@/lib/database.types";

interface Stats {
  totalProducts: number;
  totalRevenue: number;
  totalAdCost: number;
  totalExpenses: number;
  totalNetRevenue: number;
  totalCOGS: number;
  grossProfit: number;
  netProfit: number;
  poas: number | null;
  lowStockCount: number;
  outOfStockCount: number;
  orderCount: number;
}

type Period = "all" | "month" | "week";

function getPeriodRange(period: Period): { from: string; to: string } | null {
  if (period === "all") return null;
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (period === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    return { from, to };
  }
  // week: Monday of current week
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  return { from: monday.toISOString().slice(0, 10), to };
}

export default function AnalyticsPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [allOrders, setAllOrders] = useState<{ order_date: string | null; order_amount: number | null; net_revenue: number | null }[]>([]);
  const [allAds, setAllAds] = useState<{ amount: number | null; date: string | null }[]>([]);
  const [allExpenses, setAllExpenses] = useState<{ amount: number | null; date: string | null }[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"profit" | "margin" | "stock" | "total_profit">("profit");
  const [period, setPeriod] = useState<Period>("all");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [prodRes, ordersRes, adsRes, expRes] = await Promise.all([
        getSupabase().from("products").select("*").order("product_name"),
        getSupabase().from("sales_orders").select("order_date, order_amount, net_revenue"),
        getSupabase().from("ad_costs").select("amount, date"),
        getSupabase().from("operating_expenses").select("amount, date"),
      ]);

      const prods: Product[] = prodRes.data || [];
      setProducts(prods);
      setAllOrders(ordersRes.data || []);
      setAllAds(adsRes.data || []);
      setAllExpenses(expRes.data || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Recalculate stats whenever period or raw data changes
  useEffect(() => {
    if (loading) return;
    const range = getPeriodRange(period);
    const inRange = (dateStr: string | null) => {
      if (!range) return true;
      if (!dateStr) return false;
      return dateStr >= range.from && dateStr <= range.to;
    };

    const filteredOrders = allOrders.filter((o) => inRange(o.order_date));
    const filteredAds = allAds.filter((a) => inRange(a.date));
    const filteredExpenses = allExpenses.filter((e) => inRange(e.date));

    const totalRevenue = filteredOrders.reduce((s, o) => s + (Number(o.order_amount) || 0), 0);
    const totalNetRevenue = filteredOrders.reduce((s, o) => s + (Number(o.net_revenue) || 0), 0);
    const totalAdCost = filteredAds.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const totalExpensesAmt = filteredExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    // COGS: when filtered, we can't split by period (product stats are cumulative), so use all-time
    const totalCOGS = period === "all"
      ? products.reduce((s, p) => s + (Number(p.unit_cost_ntd) || 0) * (Number(p.total_sold_qty) || 0), 0)
      : 0; // For period views, COGS not available (would need order-item level data)

    const grossProfit = totalNetRevenue - totalCOGS;
    const netProfit = grossProfit - totalAdCost - totalExpensesAmt;
    const poas = totalAdCost > 0 ? netProfit / totalAdCost : null;

    setStats({
      totalProducts: products.length,
      totalRevenue,
      totalNetRevenue,
      totalAdCost,
      totalExpenses: totalExpensesAmt,
      totalCOGS,
      grossProfit,
      netProfit,
      poas,
      lowStockCount: products.filter((p) => p.safety_stock != null && p.stock_qty > 0 && p.stock_qty <= p.safety_stock).length,
      outOfStockCount: products.filter((p) => p.stock_qty <= 0).length,
      orderCount: filteredOrders.length,
    });
  }, [period, products, allOrders, allAds, allExpenses, loading]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">載入中...</div>;
  }

  const hasData = stats && (stats.totalRevenue > 0 || stats.orderCount > 0 || stats.totalProducts > 0);

  // Product profitability ranking
  const rankedProducts = [...products]
    .map((p) => {
      const revenue = Number(p.selling_price) || 0;
      const cost = Number(p.unit_cost_ntd) || 0;
      const feeRate = Number(p.platform_fee_rate) || 0;
      const fees = revenue * (feeRate / 100);
      const profit = revenue - cost - fees;
      const margin = revenue > 0 ? profit / revenue : 0;
      const sold = Number(p.total_sold_qty) || 0;
      const totalProfit = profit * sold;
      return { ...p, profit, margin, fees, totalProfit };
    })
    .filter((p) => p.selling_price && p.selling_price > 0)
    .sort((a, b) => {
      if (sortBy === "profit") return b.profit - a.profit;
      if (sortBy === "margin") return b.margin - a.margin;
      if (sortBy === "total_profit") return b.totalProfit - a.totalProfit;
      return a.stock_qty - b.stock_qty;
    });

  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-4 py-3 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xl">&larr;</Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold">數據分析</h1>
            <p className="text-xs text-slate-300">戰情總覽</p>
          </div>
        </div>
        <div className="flex gap-1 mt-2">
          {([
            { key: "all" as Period, label: "全部" },
            { key: "month" as Period, label: "本月" },
            { key: "week" as Period, label: "本週" },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setPeriod(t.key)}
              className={`text-xs px-3 py-1 rounded-full ${
                period === t.key
                  ? "bg-white text-slate-800 font-medium"
                  : "bg-slate-700 text-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {stats && !hasData && (
        <div className="text-center py-16 px-4">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-slate-400 font-medium mb-1">尚無數據</p>
          <p className="text-xs text-slate-400">匯入銷售訂單、建立採購單後，數據分析會自動計算</p>
          <div className="flex gap-2 justify-center mt-4">
            <Link href="/orders" className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-200">匯入訂單</Link>
            <Link href="/purchase" className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200">建立採購單</Link>
          </div>
        </div>
      )}

      {stats && hasData && (
        <>
          {/* KPI Cards */}
          <div className="px-4 py-3 bg-white border-b">
            <div className="grid grid-cols-2 gap-3">
              <KPICard label="總營收" value={`$${stats.totalRevenue.toLocaleString()}`} sub={`${stats.orderCount} 筆訂單`} />
              <KPICard label="淨營收" value={`$${stats.totalNetRevenue.toLocaleString()}`} sub="扣除平台費用" color="blue" />
              <KPICard label="銷貨成本" value={period === "all" ? `$${stats.totalCOGS.toLocaleString()}` : "—"} sub={period === "all" ? "落地成本 x 銷量" : "僅全部檢視可用"} color="amber" />
              <KPICard label="毛利" value={`$${stats.grossProfit.toLocaleString()}`}
                sub={stats.totalNetRevenue > 0 ? `毛利率 ${(stats.grossProfit / stats.totalNetRevenue * 100).toFixed(1)}%` : ""}
                color={stats.grossProfit >= 0 ? "emerald" : "red"} />
            </div>
          </div>

          {/* Expense & Net Profit */}
          <div className="px-4 py-3 bg-slate-50 border-b">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-[11px] text-slate-400">廣告費</div>
                <div className="text-sm font-bold text-purple-600">${stats.totalAdCost.toLocaleString()}</div>
              </div>
              <div className="text-center">
                <div className="text-[11px] text-slate-400">營業費用</div>
                <div className="text-sm font-bold text-slate-600">${stats.totalExpenses.toLocaleString()}</div>
              </div>
              <div className="text-center">
                <div className="text-[11px] text-slate-400">POAS</div>
                <div className={`text-sm font-bold ${stats.poas && stats.poas >= 1 ? "text-emerald-600" : "text-red-500"}`}>
                  {stats.poas != null ? stats.poas.toFixed(2) : "—"}
                </div>
              </div>
            </div>
            <div className="mt-3 text-center py-2 rounded-lg bg-white border">
              <div className="text-[11px] text-slate-400">真實淨利</div>
              <div className={`text-xl font-bold ${stats.netProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                ${stats.netProfit.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-400">
                淨營收 - 銷貨成本 - 廣告 - 營業費用
              </div>
            </div>
          </div>

          {/* Inventory Alert */}
          {(stats.lowStockCount > 0 || stats.outOfStockCount > 0) && (
            <div className="px-4 py-2 bg-amber-50 border-b flex gap-4 text-sm">
              {stats.outOfStockCount > 0 && (
                <span className="text-red-600 font-medium">缺貨 {stats.outOfStockCount} 項</span>
              )}
              {stats.lowStockCount > 0 && (
                <span className="text-amber-600 font-medium">低庫存 {stats.lowStockCount} 項</span>
              )}
            </div>
          )}
        </>
      )}

      {/* Product Profitability Table */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-slate-700">商品損益排行</h2>
          <div className="flex gap-1">
            {[
              { key: "profit" as const, label: "單件利潤" },
              { key: "total_profit" as const, label: "總利潤" },
              { key: "margin" as const, label: "毛利率" },
              { key: "stock" as const, label: "庫存" },
            ].map((s) => (
              <button
                key={s.key}
                onClick={() => setSortBy(s.key)}
                className={`text-[10px] px-2 py-1 rounded-md ${
                  sortBy === s.key ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          {rankedProducts.map((p) => {
            const isNegative = p.profit < 0;
            return (
              <div key={p.id} className={`bg-white rounded-lg p-3 border ${isNegative ? "border-red-200 bg-red-50/50" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-medium truncate">{p.product_name}</h4>
                    {p.variant_name && <p className="text-[10px] text-slate-400 truncate">{p.variant_name}</p>}
                    <div className="flex gap-2 mt-1 text-[10px] text-slate-500 flex-wrap">
                      <span>售 ${p.selling_price}</span>
                      <span>成本 ${Number(p.unit_cost_ntd || 0).toFixed(0)}</span>
                      <span>費用 ${p.fees.toFixed(0)}</span>
                      <span>庫存 {p.stock_qty}</span>
                      {Number(p.total_sold_qty) > 0 && <span>已售 {p.total_sold_qty}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-sm font-bold ${isNegative ? "text-red-500" : "text-emerald-600"}`}>
                      {sortBy === "total_profit" ? `$${p.totalProfit.toFixed(0)}` : `$${p.profit.toFixed(0)}`}
                    </div>
                    <div className={`text-[10px] ${p.margin >= 0.3 ? "text-emerald-500" : p.margin >= 0.15 ? "text-amber-500" : "text-red-500"}`}>
                      {sortBy === "total_profit" ? `${p.profit.toFixed(0)}/件` : `${(p.margin * 100).toFixed(1)}%`}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  const colorClass = color === "emerald" ? "text-emerald-600"
    : color === "red" ? "text-red-500"
    : color === "blue" ? "text-blue-600"
    : color === "amber" ? "text-amber-600"
    : "text-slate-800";
  return (
    <div className="bg-slate-50 rounded-xl p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`text-lg font-bold ${colorClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
