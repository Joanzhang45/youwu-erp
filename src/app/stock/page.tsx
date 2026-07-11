"use client";

// 庫存調整（PRD §4.3）。搜尋優先，不預設 render 全量商品長牆；盤點模式排 M2 之後獨立增量。
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/Toast";
import type { Product } from "@/lib/database.types";
import { DEMO_PRODUCTS } from "@/lib/demo-data";
import { StockAdjustSheet } from "@/components/app/StockAdjustSheet";

type StockAction = { product: Product; type: "in" | "out" } | null;

function isNotDiscontinued(p: Product): boolean {
  return p.product_status !== "停售";
}

export default function StockPage() {
  const { isDemo } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stockAction, setStockAction] = useState<StockAction>(null);

  const fetchProducts = useCallback(async () => {
    if (isDemo) {
      setProducts(DEMO_PRODUCTS);
      setRecentIds(DEMO_PRODUCTS.slice(0, 4).map((p) => p.id));
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const supabase = getSupabase();
      const [prodRes, ledgerRes] = await Promise.all([
        supabase.from("v_products_with_stock").select("*").order("product_name"),
        supabase
          .from("inventory_ledger")
          .select("product_id, occurred_at")
          .eq("movement_type", "manual_adjust")
          .order("occurred_at", { ascending: false })
          .limit(30),
      ]);
      if (prodRes.error) throw prodRes.error;
      setProducts(prodRes.data || []);

      const seen = new Set<number>();
      const recent: number[] = [];
      for (const row of ledgerRes.data || []) {
        if (!seen.has(row.product_id)) {
          seen.add(row.product_id);
          recent.push(row.product_id);
        }
        if (recent.length >= 6) break;
      }
      setRecentIds(recent);
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, [isDemo, toast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const recentProducts = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p]));
    return recentIds.map((id) => map.get(id)).filter((p): p is Product => !!p && isNotDiscontinued(p));
  }, [recentIds, products]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return products
      .filter(isNotDiscontinued)
      .filter(
        (p) =>
          p.product_name.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q) ||
          p.variant_name?.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [products, search]);

  const handleStockUpdate = async (qty: number, reason: string) => {
    if (!stockAction) return;
    const { product, type } = stockAction;

    if (isDemo) {
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, stock_qty: type === "in" ? p.stock_qty + qty : p.stock_qty - qty } : p))
      );
      setStockAction(null);
      toast(`已模擬${type === "in" ? "入庫" : "出庫"} ${qty}（展示模式，未實際寫入）`);
      return;
    }

    const supabase = getSupabase();
    const { error } = await supabase.from("inventory_ledger").insert({
      product_id: product.id,
      movement_type: "manual_adjust",
      qty_delta: type === "in" ? qty : -qty,
      ref_type: "manual_adjust",
      ref_no: `MA-${Date.now()}`,
      note: reason,
    });
    if (error) throw error;

    setStockAction(null);
    toast(`已${type === "in" ? "入庫" : "出庫"} ${qty}`);
    fetchProducts();
  };

  return (
    <div className="min-h-screen bg-white">
      {isDemo && (
        <div className="bg-[#F5A623] text-[#171717] text-xs text-center py-1 font-medium">
          展示模式 — 資料為模擬
        </div>
      )}

      <header className="px-5 pt-6 pb-3 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">庫存</h1>
      </header>

      <main className="px-5 max-w-2xl mx-auto pb-8">
        {/* 搜尋優先 */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋商品名稱、SKU、款式..."
            className="w-full px-4 py-3 bg-[#FAFAFA] border border-[#EAEAEA] rounded-xl text-base outline-none focus:border-[#171717] focus:bg-white transition-colors duration-150"
          />
        </div>

        {loading ? (
          <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
        ) : search.trim() ? (
          <div className="space-y-2 app-fade-up-enter">
            {searchResults.length === 0 ? (
              <p className="text-center text-sm text-[#8F8F8F] py-8">沒有符合「{search}」的商品</p>
            ) : (
              searchResults.map((p) => (
                <StockRow
                  key={p.id}
                  product={p}
                  onIn={() => setStockAction({ product: p, type: "in" })}
                  onOut={() => setStockAction({ product: p, type: "out" })}
                />
              ))
            )}
          </div>
        ) : (
          <div className="app-fade-up-enter">
            {recentProducts.length > 0 && (
              <>
                <p className="text-xs font-medium text-[#8F8F8F] mb-2">最近操作過</p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {recentProducts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setStockAction({ product: p, type: "in" })}
                      className="px-3 py-2 rounded-xl border border-[#EAEAEA] text-sm text-[#171717] hover:border-[#171717] transition-colors duration-150 flex items-center gap-2"
                    >
                      <span className="truncate max-w-[140px]">{p.product_name}</span>
                      <span className="text-[#8F8F8F] tabular-nums">{p.stock_qty}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="text-center text-sm text-[#8F8F8F] py-8">
              輸入商品名稱、SKU 開始調整庫存
            </p>
          </div>
        )}
      </main>

      {stockAction && (
        <StockAdjustSheet
          product={stockAction.product}
          type={stockAction.type}
          onConfirm={handleStockUpdate}
          onClose={() => setStockAction(null)}
        />
      )}
    </div>
  );
}

function StockRow({ product: p, onIn, onOut }: { product: Product; onIn: () => void; onOut: () => void }) {
  const isOut = p.stock_qty <= 0;
  const isLow = !isOut && p.safety_stock != null && p.stock_qty <= p.safety_stock;

  return (
    <div className="rounded-2xl border border-[#EAEAEA] p-3 flex items-center gap-3">
      {p.product_image ? (
        <img src={p.product_image} alt={p.product_name} className="w-12 h-12 rounded-xl object-cover bg-[#FAFAFA] flex-shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-xl bg-[#FAFAFA] flex items-center justify-center flex-shrink-0 text-lg">📦</div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#171717] truncate">{p.product_name}</p>
        <div className="flex items-center gap-2">
          {p.variant_name && <p className="text-xs text-[#8F8F8F] truncate">{p.variant_name}</p>}
          <span
            className={`text-xs font-semibold tabular-nums flex-shrink-0 ${
              isOut ? "text-[#E00]" : isLow ? "text-[#F5A623]" : "text-[#171717]"
            }`}
          >
            庫存 {p.stock_qty.toLocaleString()}
          </span>
        </div>
      </div>
      <div className="flex gap-1.5 flex-shrink-0">
        <button
          onClick={onIn}
          className="w-9 h-9 rounded-lg bg-[#0CCE6B]/10 text-[#0CCE6B] font-bold text-lg active:scale-[0.95] transition-transform duration-150"
          aria-label="入庫"
        >
          +
        </button>
        <button
          onClick={onOut}
          disabled={isOut}
          className="w-9 h-9 rounded-lg bg-[#0070F3]/10 text-[#0070F3] font-bold text-lg active:scale-[0.95] transition-transform duration-150 disabled:opacity-30"
          aria-label="出庫"
        >
          −
        </button>
      </div>
    </div>
  );
}
