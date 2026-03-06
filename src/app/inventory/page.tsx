"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import type { Product } from "@/lib/database.types";
import { DEMO_PRODUCTS } from "@/lib/demo-data";
import { StockModal } from "@/components/StockModal";

type StockAction = { product: Product; type: "in" | "out" } | null;

const isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL;

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stockAction, setStockAction] = useState<StockAction>(null);
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");

  const fetchProducts = useCallback(async () => {
    if (isDemo) {
      setProducts(DEMO_PRODUCTS);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data, error: err } = await getSupabase()
        .from("products")
        .select("*")
        .order("product_name");

      if (err) throw err;
      setProducts(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const filtered = products.filter((p) => {
    const matchSearch =
      !search ||
      p.product_name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.toLowerCase()) ||
      p.variant_name?.toLowerCase().includes(search.toLowerCase());

    if (filter === "low")
      return matchSearch && p.stock_qty > 0 && p.safety_stock != null && p.stock_qty <= p.safety_stock;
    if (filter === "out") return matchSearch && p.stock_qty <= 0;
    return matchSearch;
  });

  const lowStockCount = products.filter(
    (p) => p.stock_qty > 0 && p.safety_stock != null && p.stock_qty <= p.safety_stock
  ).length;
  const outOfStockCount = products.filter((p) => p.stock_qty <= 0).length;

  const handleStockUpdate = async (qty: number, notes: string) => {
    if (!stockAction) return;
    const { product, type } = stockAction;

    if (isDemo) {
      // Demo mode: update local state
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== product.id) return p;
          const field = type === "in" ? "total_purchased_qty" : "total_shipped_qty";
          return { ...p, [field]: p[field] + qty, stock_qty: type === "in" ? p.stock_qty + qty : p.stock_qty - qty };
        })
      );
      setStockAction(null);
      return;
    }

    const { error: mvErr } = await getSupabase().from("stock_movements").insert({
      product_id: product.id,
      movement_type: type,
      qty,
      reference_type: "adjustment",
      notes,
      created_by: "manual",
    });
    if (mvErr) throw mvErr;

    // Update product stock counts + stock_qty
    const newPurchased = type === "in" ? product.total_purchased_qty + qty : product.total_purchased_qty;
    const newShipped = type === "out" ? product.total_shipped_qty + qty : product.total_shipped_qty;
    const { error: prodErr } = await getSupabase()
      .from("products")
      .update({
        total_purchased_qty: newPurchased,
        total_shipped_qty: newShipped,
        stock_qty: newPurchased - newShipped,
      })
      .eq("id", product.id);
    if (prodErr) throw prodErr;

    setStockAction(null);
    fetchProducts();
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <p className="text-sm text-slate-500 mb-4">
            請確認 .env.local 中的 Supabase 設定是否正確
          </p>
          <Link href="/" className="text-blue-500 underline">
            返回首頁
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Demo Banner */}
      {isDemo && (
        <div className="bg-amber-400 text-amber-900 text-xs text-center py-1 font-medium">
          展示模式 — 資料為模擬，請設定 Supabase 連線
        </div>
      )}

      {/* Header */}
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/" className="text-xl">
          &larr;
        </Link>
        <div>
          <h1 className="text-lg font-bold">庫存管理</h1>
          <p className="text-xs text-slate-300">
            共 {products.length} 項商品
          </p>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b overflow-x-auto">
        <button
          onClick={() => setFilter("all")}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            filter === "all"
              ? "bg-slate-800 text-white"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          全部 {products.length}
        </button>
        <button
          onClick={() => setFilter("low")}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            filter === "low"
              ? "bg-amber-500 text-white"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          低庫存 {lowStockCount}
        </button>
        <button
          onClick={() => setFilter("out")}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            filter === "out"
              ? "bg-red-500 text-white"
              : "bg-red-50 text-red-700"
          }`}
        >
          缺貨 {outOfStockCount}
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2 bg-white border-b sticky top-[52px] z-20">
        <input
          type="text"
          placeholder="搜尋商品名稱、SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 bg-slate-100 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      {/* Product List */}
      <div className="px-4 py-2">
        {loading ? (
          <div className="text-center py-12 text-slate-400">載入中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-2">
              {products.length === 0 ? "尚無商品資料" : "沒有符合的商品"}
            </p>
            {products.length === 0 && (
              <p className="text-xs text-slate-400">
                請先在 Supabase 匯入商品資料，或從「商品資訊」新增
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onStockIn={() => setStockAction({ product: p, type: "in" })}
                onStockOut={() => setStockAction({ product: p, type: "out" })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Stock Modal */}
      {stockAction && (
        <StockModal
          product={stockAction.product}
          type={stockAction.type}
          onConfirm={handleStockUpdate}
          onClose={() => setStockAction(null)}
        />
      )}
    </div>
  );
}

function ProductCard({
  product: p,
  onStockIn,
  onStockOut,
}: {
  product: Product;
  onStockIn: () => void;
  onStockOut: () => void;
}) {
  const isLow = p.safety_stock != null && p.stock_qty > 0 && p.stock_qty <= p.safety_stock;
  const isOut = p.stock_qty <= 0;

  return (
    <div
      className={`bg-white rounded-xl p-3 shadow-sm border ${
        isOut
          ? "border-red-200 bg-red-50/50"
          : isLow
          ? "border-amber-200 bg-amber-50/50"
          : "border-slate-200"
      }`}
    >
      <div className="flex gap-3">
        {/* Product Image */}
        {p.product_image ? (
          <img
            src={p.product_image}
            alt={p.product_name}
            className="w-14 h-14 rounded-lg object-cover flex-shrink-0 bg-slate-100"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 text-xl">
            📦
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-medium text-sm truncate">{p.product_name}</h3>
              {p.variant_name && (
                <p className="text-xs text-slate-500 truncate">{p.variant_name}</p>
              )}
            </div>
            {/* Stock Badge */}
            <div
              className={`flex-shrink-0 text-right ${
                isOut
                  ? "text-red-600"
                  : isLow
                  ? "text-amber-600"
                  : "text-slate-800"
              }`}
            >
              <div className="text-lg font-bold leading-tight">{p.stock_qty}</div>
              <div className="text-[10px] text-slate-400">
                {p.safety_stock != null ? `安全 ${p.safety_stock}` : ""}
              </div>
            </div>
          </div>

          {/* SKU & Category */}
          <div className="flex items-center gap-2 mt-1">
            {p.sku && (
              <span className="text-[10px] text-slate-400 font-mono">{p.sku}</span>
            )}
            {p.category && (
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">
                {p.category}
              </span>
            )}
            {p.selling_price && (
              <span className="text-[10px] text-slate-500">
                ${p.selling_price}
              </span>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 mt-2">
            <button
              onClick={onStockIn}
              className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 active:bg-emerald-100 transition-colors"
            >
              + 入庫
            </button>
            <button
              onClick={onStockOut}
              className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 border border-blue-200 active:bg-blue-100 transition-colors"
              disabled={p.stock_qty <= 0}
            >
              - 出庫
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
