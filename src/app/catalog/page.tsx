"use client";

// 商品主檔（PRD §2.3 #02、§3，取代舊 /products）。搜尋優先＋分頁——舊頁 165 項全量 render
// 的長牆病禁重現，預設與搜尋結果都只 range() 抓當頁。工具區收「蝦皮對應」（原 #03 /products/mapping
// 降級併入，208 組合僅 2 筆未對應，自動化已成熟，這裡只做輕量對帳＋手動補一筆，不搬舊頁全部 UI）。
// 詳情／編輯走 ?id= query param（static export 無動態路由，同 /inbound 既有慣例），
// 新增走底部 sheet（ProductFormSheet，範圍窄不需要整頁）。
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { Product } from "@/lib/database.types";
import { RequireAuth } from "@/components/app/RequireAuth";
import { ProductDetail } from "@/components/app/ProductDetail";
import { ProductFormSheet } from "@/components/app/ProductFormSheet";
import { ChevronRightIcon, PlusIcon, SearchIcon, LinkIcon } from "@/components/app/icons";

const PAGE_SIZE = 20;

export default function CatalogPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[#8F8F8F] text-sm">載入中...</div>}>
        <CatalogContent />
      </Suspense>
    </RequireAuth>
  );
}

function CatalogContent() {
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");
  if (idParam) return <ProductDetail id={Number(idParam)} />;
  return <CatalogHome />;
}

function isNotDiscontinued(p: Product): boolean {
  return p.product_status !== "停售";
}

function CatalogHome() {
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  // 搜尋 debounce（300ms），避免每個字都打一次 API
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // M5：舊 /products/mapping 退場 redirect 到 /catalog#mapping-tool，帶 hash 進站時
  // 自動展開工具區，不然使用者會落在一個看起來空的頁面找不到蝦皮對應在哪。
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#mapping-tool") {
      setToolsOpen(true);
    }
  }, []);

  const loadPage = useCallback(
    async (reset: boolean) => {
      reset ? setLoading(true) : setLoadingMore(true);
      try {
        const supabase = getSupabase();
        const from = reset ? 0 : offset;
        let query = supabase.from("v_products_with_stock").select("*", { count: "exact" }).order("product_name");
        if (search) {
          query = query.or(`product_name.ilike.%${search}%,sku.ilike.%${search}%,variant_name.ilike.%${search}%`);
        }
        query = query.range(from, from + PAGE_SIZE - 1);
        const { data, error, count } = await query;
        if (error) throw error;
        const rows = data || [];
        setItems((prev) => (reset ? rows : [...prev, ...rows]));
        setOffset(from + rows.length);
        setTotal(count ?? 0);
        setHasMore(rows.length === PAGE_SIZE);
      } catch (e) {
        toast(e instanceof Error ? e.message : "載入失敗", "error");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [search, offset, toast]
  );

  useEffect(() => {
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const createProduct = async (form: Partial<Product>) => {
    if (!form.product_name?.trim()) throw new Error("請輸入商品名稱");
    const { error } = await getSupabase()
      .from("products")
      .insert({
        product_name: form.product_name.trim(),
        sku: form.sku || null,
        category: form.category || null,
        variant_name: form.variant_name || null,
        selling_price: form.selling_price ?? null,
        purchase_price_cny: form.purchase_price_cny ?? null,
        unit_cost_ntd: form.unit_cost_ntd ?? null,
        weight_kg: form.weight_kg ?? null,
        safety_stock: form.safety_stock ?? null,
        product_status: form.product_status || "測品",
        product_positioning: form.product_positioning || "一般款",
        notes: form.notes || null,
      });
    if (error) throw error;
    setShowAdd(false);
    toast("已新增商品");
    loadPage(true);
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="px-5 pt-6 pb-3 max-w-2xl mx-auto flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">商品</h1>
          <p className="text-sm text-[#8F8F8F] mt-0.5">共 {total.toLocaleString()} 項商品</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="w-10 h-10 rounded-full bg-[#171717] text-white flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform duration-150"
          aria-label="新增商品"
        >
          <PlusIcon className="w-5 h-5" />
        </button>
      </header>

      <main className="px-5 max-w-2xl mx-auto pb-10">
        <div className="relative mb-4">
          <SearchIcon className="w-4 h-4 text-[#8F8F8F] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜尋商品名稱、SKU、款式..."
            className="w-full pl-10 pr-4 py-3 bg-[#FAFAFA] border border-[#EAEAEA] rounded-xl text-base outline-none focus:border-[#171717] focus:bg-white transition-colors duration-150"
          />
        </div>

        {loading ? (
          <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
        ) : items.length === 0 ? (
          <p className="text-center text-sm text-[#8F8F8F] py-12">
            {search ? `沒有符合「${search}」的商品` : "尚無商品資料"}
          </p>
        ) : (
          <div className="space-y-2 app-fade-up-enter">
            {items.map((p) => (
              <ProductRow key={p.id} product={p} />
            ))}
            {hasMore && (
              <button
                onClick={() => loadPage(false)}
                disabled={loadingMore}
                className="w-full mt-2 py-2.5 text-sm text-[#0070F3] hover:underline disabled:opacity-50"
              >
                {loadingMore ? "載入中..." : `載入更多（已顯示 ${items.length}／${total}）`}
              </button>
            )}
          </div>
        )}

        {/* 工具區：蝦皮對應（原 /products/mapping 降級併入，PRD §2.3 #03） */}
        <div id="mapping-tool" className="mt-8">
          <button
            onClick={() => setToolsOpen((v) => !v)}
            className="w-full flex items-center justify-between py-2.5 text-sm text-[#8F8F8F]"
          >
            <span className="flex items-center gap-1.5">
              <LinkIcon className="w-4 h-4" />
              工具：蝦皮商品對應
            </span>
            <ChevronRightIcon className={`w-4 h-4 transition-transform duration-150 ${toolsOpen ? "rotate-90" : ""}`} />
          </button>
          {toolsOpen && <MappingTool />}
        </div>
      </main>

      {showAdd && <ProductFormSheet onCreate={createProduct} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function ProductRow({ product: p }: { product: Product }) {
  const isOut = p.stock_qty <= 0;
  const isLow = !isOut && p.safety_stock != null && p.stock_qty <= p.safety_stock;
  const margin = p.gross_margin != null ? (p.gross_margin * 100).toFixed(0) : null;

  return (
    <Link
      href={`/catalog?id=${p.id}`}
      className="block rounded-2xl border border-[#EAEAEA] p-3 hover:border-[#171717] transition-colors duration-150 bg-white"
    >
      <div className="flex items-center gap-3">
        {p.product_image ? (
          <img src={p.product_image} alt={p.product_name} className="w-14 h-14 rounded-xl object-cover bg-[#FAFAFA] flex-shrink-0" />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-[#FAFAFA] flex items-center justify-center flex-shrink-0 text-xl">📦</div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#171717] truncate">{p.product_name}</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {p.variant_name && <p className="text-xs text-[#8F8F8F] truncate">{p.variant_name}</p>}
            {p.product_status === "停售" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FAFAFA] text-[#8F8F8F] border border-[#EAEAEA] flex-shrink-0">停售</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {p.selling_price != null && <span className="text-xs text-[#171717] font-medium tabular-nums">${p.selling_price.toLocaleString()}</span>}
            {p.unit_cost_ntd != null && <span className="text-[11px] text-[#8F8F8F] tabular-nums">成本 ${p.unit_cost_ntd.toFixed(0)}</span>}
            {margin != null && <span className="text-[11px] text-[#8F8F8F] tabular-nums">毛利 {margin}%</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`text-sm font-semibold tabular-nums ${isOut ? "text-[#E00]" : isLow ? "text-[#F5A623]" : "text-[#171717]"}`}>
            {p.stock_qty.toLocaleString()}
          </p>
          <p className="text-[10px] text-[#8F8F8F]">庫存</p>
        </div>
      </div>
    </Link>
  );
}

type UnmappedCombo = { product_name: string; variant_name: string; count: number };

function MappingTool() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [unmapped, setUnmapped] = useState<UnmappedCombo[]>([]);
  const [mappedCount, setMappedCount] = useState(0);
  const [products, setProducts] = useState<Pick<Product, "id" | "product_name" | "variant_name" | "sku">[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTool = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [unmappedRes, mappedCountRes, prodRes] = await Promise.all([
        supabase.from("sales_order_items").select("product_name, variant_name").is("product_id", null),
        supabase.from("sales_order_items").select("*", { count: "exact", head: true }).not("product_id", "is", null),
        supabase.from("products").select("id, product_name, variant_name, sku").order("product_name"),
      ]);
      if (unmappedRes.error) throw unmappedRes.error;
      const seen = new Map<string, UnmappedCombo>();
      for (const row of unmappedRes.data || []) {
        const key = `${row.product_name || ""}|||${row.variant_name || ""}`;
        const existing = seen.get(key);
        if (existing) existing.count++;
        else seen.set(key, { product_name: row.product_name || "（未命名）", variant_name: row.variant_name || "", count: 1 });
      }
      setUnmapped(Array.from(seen.values()).sort((a, b) => b.count - a.count));
      setMappedCount(mappedCountRes.count ?? 0);
      setProducts(prodRes.data || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchTool();
  }, [fetchTool]);

  const filteredProducts = useMemo(() => {
    if (!pickerSearch.trim()) return products.slice(0, 20);
    const q = pickerSearch.trim().toLowerCase();
    return products
      .filter((p) => p.product_name.toLowerCase().includes(q) || p.variant_name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q))
      .slice(0, 20);
  }, [products, pickerSearch]);

  const applyMapping = async (combo: UnmappedCombo, productId: number) => {
    setSaving(true);
    try {
      let query = getSupabase().from("sales_order_items").update({ product_id: productId }).eq("product_name", combo.product_name);
      query = combo.variant_name ? query.eq("variant_name", combo.variant_name) : query.is("variant_name", null);
      const { error } = await query;
      if (error) throw error;
      toast(`已對應 ${combo.count} 筆訂單品項`);
      setExpandedKey(null);
      fetchTool();
    } catch (e) {
      toast(e instanceof Error ? e.message : "對應失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-6 text-[#8F8F8F] text-sm">載入中...</div>;
  }

  return (
    <div className="mt-2 app-fade-up-enter">
      <div className="rounded-2xl border border-[#EAEAEA] p-4 mb-3">
        <div className="grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="text-lg font-semibold text-[#0CCE6B] tabular-nums">{mappedCount.toLocaleString()}</p>
            <p className="text-[11px] text-[#8F8F8F] mt-0.5">已對應品項筆數</p>
          </div>
          <div>
            <p className={`text-lg font-semibold tabular-nums ${unmapped.length > 0 ? "text-[#F5A623]" : "text-[#171717]"}`}>
              {unmapped.reduce((s, c) => s + c.count, 0).toLocaleString()}
            </p>
            <p className="text-[11px] text-[#8F8F8F] mt-0.5">未對應品項筆數</p>
          </div>
        </div>
      </div>

      {unmapped.length === 0 ? (
        <p className="text-center text-sm text-[#8F8F8F] py-6">所有蝦皮品項組合都已對應</p>
      ) : (
        <div className="space-y-2">
          {unmapped.map((combo) => {
            const key = `${combo.product_name}|||${combo.variant_name}`;
            const isExpanded = expandedKey === key;
            return (
              <div key={key} className="rounded-xl border border-[#F5A623]/30 bg-[#F5A623]/5 overflow-hidden">
                <button
                  onClick={() => {
                    setExpandedKey(isExpanded ? null : key);
                    setPickerSearch("");
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#171717] truncate">{combo.product_name}</p>
                    {combo.variant_name && <p className="text-[11px] text-[#8F8F8F] truncate">{combo.variant_name}</p>}
                  </div>
                  <span className="text-[11px] text-[#8F8F8F] flex-shrink-0 bg-white px-1.5 py-0.5 rounded border border-[#EAEAEA]">
                    {combo.count}x
                  </span>
                </button>
                {isExpanded && (
                  <div className="border-t border-[#F5A623]/30 px-3 py-3 space-y-2 bg-white">
                    <input
                      type="text"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder="搜尋商品名稱、SKU..."
                      autoFocus
                      className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717]"
                    />
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {filteredProducts.map((p) => (
                        <button
                          key={p.id}
                          disabled={saving}
                          onClick={() => applyMapping(combo, p.id)}
                          className="w-full text-left px-2.5 py-2 rounded-lg text-xs hover:bg-[#FAFAFA] transition-colors duration-150 disabled:opacity-50"
                        >
                          <span className="font-medium text-[#171717]">{p.product_name}</span>
                          {p.variant_name && <span className="text-[#8F8F8F] ml-1">| {p.variant_name}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
