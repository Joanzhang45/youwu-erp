"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
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

export default function AnalyticsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"profit" | "margin" | "stock">("profit");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [prodRes, ordersRes, adsRes, expRes] = await Promise.all([
        getSupabase().from("products").select("*").order("product_name"),
        getSupabase().from("sales_orders").select("order_amount, net_revenue"),
        getSupabase().from("ad_costs").select("amount"),
        getSupabase().from("operating_expenses").select("amount"),
      ]);

      const prods: Product[] = prodRes.data || [];
      setProducts(prods);

      const totalRevenue = (ordersRes.data || []).reduce((s, o) => s + (Number(o.order_amount) || 0), 0);
      const totalNetRevenue = (ordersRes.data || []).reduce((s, o) => s + (Number(o.net_revenue) || 0), 0);
      const totalAdCost = (adsRes.data || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
      const totalExpenses = (expRes.data || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);

      // COGS = sum of (unit_cost_ntd * total_sold_qty) for each product
      const totalCOGS = prods.reduce((s, p) => {
        const cost = Number(p.unit_cost_ntd) || 0;
        const sold = Number(p.total_sold_qty) || 0;
        return s + cost * sold;
      }, 0);

      const grossProfit = totalNetRevenue - totalCOGS;
      const netProfit = grossProfit - totalAdCost - totalExpenses;
      const poas = totalAdCost > 0 ? netProfit / totalAdCost : null;

      setStats({
        totalProducts: prods.length,
        totalRevenue,
        totalNetRevenue,
        totalAdCost,
        totalExpenses,
        totalCOGS,
        grossProfit,
        netProfit,
        poas,
        lowStockCount: prods.filter((p) => p.safety_stock != null && p.stock_qty > 0 && p.stock_qty <= p.safety_stock).length,
        outOfStockCount: prods.filter((p) => p.stock_qty <= 0).length,
        orderCount: (ordersRes.data || []).length,
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">載入中...</div>;
  }

  // Product profitability ranking
  const rankedProducts = [...products]
    .map((p) => {
      const revenue = Number(p.selling_price) || 0;
      const cost = Number(p.unit_cost_ntd) || 0;
      const feeRate = Number(p.platform_fee_rate) || 0;
      const fees = revenue * (feeRate / 100);
      const profit = revenue - cost - fees;
      const margin = revenue > 0 ? profit / revenue : 0;
      return { ...p, profit, margin, fees };
    })
    .filter((p) => p.selling_price && p.selling_price > 0)
    .sort((a, b) => {
      if (sortBy === "profit") return b.profit - a.profit;
      if (sortBy === "margin") return b.margin - a.margin;
      return a.stock_qty - b.stock_qty;
    });

  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/" className="text-xl">&larr;</Link>
        <div>
          <h1 className="text-lg font-bold">數據分析</h1>
          <p className="text-xs text-slate-300">戰情總覽</p>
        </div>
      </header>

      {stats && (
        <>
          {/* KPI Cards */}
          <div className="px-4 py-3 bg-white border-b">
            <div className="grid grid-cols-2 gap-3">
              <KPICard label="總營收" value={`$${stats.totalRevenue.toLocaleString()}`} sub={`${stats.orderCount} 筆訂單`} />
              <KPICard label="淨營收" value={`$${stats.totalNetRevenue.toLocaleString()}`} sub="扣除平台費用" color="blue" />
              <KPICard label="銷貨成本" value={`$${stats.totalCOGS.toLocaleString()}`} sub="落地成本 x 銷量" color="amber" />
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
              { key: "profit" as const, label: "利潤" },
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
                    <div className="flex gap-2 mt-1 text-[10px] text-slate-500">
                      <span>售 ${p.selling_price}</span>
                      <span>成本 ${Number(p.unit_cost_ntd || 0).toFixed(0)}</span>
                      <span>費用 ${p.fees.toFixed(0)}</span>
                      <span>庫存 {p.stock_qty}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-sm font-bold ${isNegative ? "text-red-500" : "text-emerald-600"}`}>
                      ${p.profit.toFixed(0)}
                    </div>
                    <div className={`text-[10px] ${p.margin >= 0.3 ? "text-emerald-500" : p.margin >= 0.15 ? "text-amber-500" : "text-red-500"}`}>
                      {(p.margin * 100).toFixed(1)}%
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
