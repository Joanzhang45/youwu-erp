"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

const modules = [
  { href: "/inventory", label: "庫存管理", desc: "查看庫存、出入庫", icon: "📦", statKey: "inventory" as const },
  { href: "/products", label: "商品資訊", desc: "商品與成本管理", icon: "🏷️", statKey: "products" as const },
  { href: "/selections", label: "選品管理", desc: "選品評估、競品分析", icon: "🔍", statKey: "selections" as const },
  { href: "/purchase", label: "採購管理", desc: "採購單、物流追蹤", icon: "🛒", statKey: "purchase" as const },
  { href: "/logistics", label: "境內物流", desc: "境內運送追蹤", icon: "🚚", statKey: "logistics" as const },
  { href: "/orders", label: "銷售訂單", desc: "蝦皮訂單匯入", icon: "📋", statKey: "orders" as const },
  { href: "/expenses", label: "費用管理", desc: "廣告、營業費用", icon: "💰", statKey: "expenses" as const },
  { href: "/analytics", label: "數據分析", desc: "毛利、庫存報表", icon: "📊", statKey: "analytics" as const },
];

type QuickStats = {
  inventory: string | null;
  products: string | null;
  selections: string | null;
  purchase: string | null;
  logistics: string | null;
  orders: string | null;
  expenses: string | null;
  analytics: string | null;
};

export default function Home() {
  const [stats, setStats] = useState<QuickStats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const [prodRes, poRes, ordersRes, adsRes, expRes, selRes, logRes] = await Promise.all([
        getSupabase().from("products").select("stock_qty, safety_stock", { count: "exact" }),
        getSupabase().from("purchase_orders").select("status_received, status_cancelled", { count: "exact" }),
        getSupabase().from("sales_orders").select("id", { count: "exact" }),
        getSupabase().from("ad_costs").select("amount"),
        getSupabase().from("operating_expenses").select("amount"),
        getSupabase().from("product_selections").select("status", { count: "exact" }),
        getSupabase().from("domestic_logistics").select("status", { count: "exact" }),
      ]);

      const products = prodRes.data || [];
      const outOfStock = products.filter((p) => p.stock_qty <= 0).length;
      const lowStock = products.filter(
        (p) => p.stock_qty > 0 && p.safety_stock != null && p.stock_qty <= p.safety_stock
      ).length;

      const pos = poRes.data || [];
      const activePOs = pos.filter((p) => !p.status_received && !p.status_cancelled).length;

      const orderCount = ordersRes.count || 0;

      const totalAds = (adsRes.data || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
      const totalExp = (expRes.data || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);

      const alerts: string[] = [];
      if (outOfStock > 0) alerts.push(`${outOfStock} 缺貨`);
      if (lowStock > 0) alerts.push(`${lowStock} 低庫存`);

      const sels = selRes.data || [];
      const evalSels = sels.filter((s) => s.status === "評估中").length;

      const logs = logRes.data || [];
      const activeLogs = logs.filter((l) => l.status !== "已入倉" && l.status !== "已到達").length;

      setStats({
        inventory: alerts.length > 0 ? alerts.join("、") : `${products.length} 項正常`,
        products: `${products.length} 項商品`,
        selections: evalSels > 0 ? `${evalSels} 筆評估中` : `共 ${sels.length} 筆`,
        purchase: activePOs > 0 ? `${activePOs} 單進行中` : `共 ${pos.length} 單`,
        logistics: activeLogs > 0 ? `${activeLogs} 筆運送中` : `共 ${logs.length} 筆`,
        orders: `${orderCount} 筆訂單`,
        expenses: `$${(totalAds + totalExp).toLocaleString()}`,
        analytics: null,
      });
    } catch {
      // silently fail — stats are optional
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-slate-800 text-white px-4 py-6">
        <h1 className="text-2xl font-bold">有物製所 ERP</h1>
        <p className="text-slate-300 text-sm mt-1">庫存與營運管理系統</p>
      </header>

      {/* Alert Banner */}
      {stats?.inventory && stats.inventory.includes("缺貨") && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center gap-2">
          <span className="text-red-500 text-sm font-medium">
            {stats.inventory}
          </span>
          <Link href="/inventory?filter=out" className="text-xs text-red-400 underline ml-auto">
            查看
          </Link>
        </div>
      )}

      {/* Module Grid */}
      <main className="p-4 max-w-lg mx-auto">
        <div className="grid grid-cols-2 gap-3">
          {modules.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="block rounded-xl p-4 shadow-sm border bg-white border-slate-200 hover:shadow-md hover:border-blue-300 active:scale-[0.98] transition-all"
            >
              <div className="text-3xl mb-2">{m.icon}</div>
              <div className="font-semibold text-sm">{m.label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{m.desc}</div>
              {stats && stats[m.statKey] && (
                <div className={`text-[11px] mt-1.5 font-medium ${
                  stats[m.statKey]!.includes("缺貨") ? "text-red-500" :
                  stats[m.statKey]!.includes("低庫存") ? "text-amber-500" :
                  "text-blue-500"
                }`}>
                  {stats[m.statKey]}
                </div>
              )}
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
