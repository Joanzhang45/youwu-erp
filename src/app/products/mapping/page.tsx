"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { Product } from "@/lib/database.types";

interface ShopeeItem {
  product_name: string;
  variant_name: string;
  count: number;
  product_id: number | null;
  matched_product?: Product;
}

// Simple fuzzy match: tokenize and count shared tokens
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/有物[🧺]?\s*/g, "")
      .replace(/現貨|隔日|秒出|當日出貨/g, "")
      .replace(/[^\u4e00-\u9fff\w]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0);
  const tokensA = normalize(a);
  const tokensB = normalize(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  let matches = 0;
  for (const ta of tokensA) {
    for (const tb of tokensB) {
      if (ta.includes(tb) || tb.includes(ta)) {
        matches++;
        break;
      }
    }
  }
  return matches / Math.max(tokensA.length, tokensB.length);
}

function findBestMatch(shopeeName: string, shopeeVariant: string, products: Product[]): Product | null {
  let bestScore = 0;
  let bestProduct: Product | null = null;

  for (const p of products) {
    // Score product name match
    const nameScore = similarity(shopeeName, p.product_name);

    // Score variant match
    let variantScore = 0;
    if (shopeeVariant && p.variant_name) {
      variantScore = similarity(shopeeVariant, p.variant_name);
    }

    const totalScore = nameScore * 0.6 + variantScore * 0.4;

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestProduct = p;
    }
  }

  return bestScore > 0.15 ? bestProduct : null;
}

export default function ProductMappingPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [shopeeItems, setShopeeItems] = useState<ShopeeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mappings, setMappings] = useState<Record<string, number | null>>({});
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unmapped" | "mapped">("unmapped");
  const [savedCount, setSavedCount] = useState(0);

  const makeKey = (name: string, variant: string) => `${name}|||${variant}`;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch products
      const { data: prods, error: prodErr } = await getSupabase()
        .from("products")
        .select("*")
        .order("product_name");
      if (prodErr) throw prodErr;
      setProducts(prods || []);

      // Fetch all sales order items (paginated)
      const allItems: { product_id: number | null; product_name: string; variant_name: string }[] = [];
      let offset = 0;
      while (true) {
        const { data, error: err } = await getSupabase()
          .from("sales_order_items")
          .select("product_id,product_name,variant_name")
          .range(offset, offset + 999);
        if (err) throw err;
        allItems.push(...(data || []));
        if (!data || data.length < 1000) break;
        offset += 1000;
      }

      // Group by product_name + variant_name
      const groups: Record<string, ShopeeItem> = {};
      for (const item of allItems) {
        const key = makeKey(item.product_name || "", item.variant_name || "");
        if (!groups[key]) {
          groups[key] = {
            product_name: item.product_name || "",
            variant_name: item.variant_name || "",
            count: 0,
            product_id: item.product_id,
          };
        }
        groups[key].count++;
        // If any item in this group already has a product_id, use it
        if (item.product_id) {
          groups[key].product_id = item.product_id;
        }
      }

      const items = Object.values(groups).sort((a, b) => b.count - a.count);
      setShopeeItems(items);

      // Auto-suggest matches
      const autoMappings: Record<string, number | null> = {};
      for (const item of items) {
        const key = makeKey(item.product_name, item.variant_name);
        if (item.product_id) {
          autoMappings[key] = item.product_id;
        } else {
          const match = findBestMatch(item.product_name, item.variant_name, prods || []);
          if (match) {
            autoMappings[key] = match.id;
          }
        }
      }
      setMappings(autoMappings);
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    return shopeeItems.filter((item) => {
      const key = makeKey(item.product_name, item.variant_name);
      const hasMappingOrExisting = mappings[key] != null || item.product_id != null;
      if (filter === "unmapped") return !hasMappingOrExisting;
      if (filter === "mapped") return hasMappingOrExisting;
      return true;
    });
  }, [shopeeItems, mappings, filter]);

  const mappedCount = shopeeItems.filter((item) => {
    const key = makeKey(item.product_name, item.variant_name);
    return mappings[key] != null || item.product_id != null;
  }).length;

  const unmappedCount = shopeeItems.length - mappedCount;

  const setMapping = (shopeeItem: ShopeeItem, productId: number | null) => {
    const key = makeKey(shopeeItem.product_name, shopeeItem.variant_name);
    setMappings((prev) => ({ ...prev, [key]: productId }));
    setExpandedKey(null);
  };

  const saveAllMappings = async () => {
    setSaving(true);
    let saved = 0;
    try {
      for (const item of shopeeItems) {
        const key = makeKey(item.product_name, item.variant_name);
        const productId = mappings[key];
        if (productId == null) continue;
        if (item.product_id === productId) continue; // Already saved

        // Update all sales_order_items matching this name+variant
        let query = getSupabase()
          .from("sales_order_items")
          .update({ product_id: productId })
          .eq("product_name", item.product_name);

        if (item.variant_name) {
          query = query.eq("variant_name", item.variant_name);
        } else {
          query = query.is("variant_name", null);
        }

        const { error: err } = await query;
        if (err) {
          console.error(`Failed to update ${item.product_name}: ${err.message}`);
          continue;
        }
        saved += item.count;
      }

      setSavedCount(saved);
      toast(`已更新 ${saved} 筆訂單品項的商品對應`, "success");
      fetchData(); // Refresh to show updated status
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const getProductById = (id: number | null): Product | undefined => {
    if (id == null) return undefined;
    return products.find((p) => p.id === id);
  };

  const getFilteredProducts = (searchTerm: string): Product[] => {
    if (!searchTerm) return products.slice(0, 20);
    const term = searchTerm.toLowerCase();
    return products
      .filter(
        (p) =>
          p.product_name.toLowerCase().includes(term) ||
          p.variant_name?.toLowerCase().includes(term) ||
          p.sku?.toLowerCase().includes(term)
      )
      .slice(0, 20);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        載入中... (分析 1,607 筆訂單品項)
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-4 py-3 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Link href="/products" className="text-xl">&larr;</Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold">商品對應</h1>
            <p className="text-xs text-slate-300">
              蝦皮商品 → 內部商品主檔 | {shopeeItems.length} 種組合
            </p>
          </div>
          <button
            onClick={saveAllMappings}
            disabled={saving || mappedCount === 0}
            className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium active:bg-emerald-600 disabled:opacity-50"
          >
            {saving ? "儲存中..." : `儲存對應 (${mappedCount})`}
          </button>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="px-4 py-3 bg-white border-b">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold">{shopeeItems.length}</div>
            <div className="text-[10px] text-slate-500">蝦皮品項</div>
          </div>
          <div>
            <div className="text-lg font-bold text-emerald-600">{mappedCount}</div>
            <div className="text-[10px] text-slate-500">已對應</div>
          </div>
          <div>
            <div className="text-lg font-bold text-amber-600">{unmappedCount}</div>
            <div className="text-[10px] text-slate-500">未對應</div>
          </div>
        </div>
        {savedCount > 0 && (
          <p className="text-xs text-emerald-600 text-center mt-2">
            上次儲存: 已更新 {savedCount} 筆訂單品項
          </p>
        )}
      </div>

      {/* Filter */}
      <div className="flex gap-2 px-4 py-2 bg-white border-b overflow-x-auto">
        <FilterTab label={`全部 ${shopeeItems.length}`} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterTab label={`未對應 ${unmappedCount}`} active={filter === "unmapped"} onClick={() => setFilter("unmapped")} color="amber" />
        <FilterTab label={`已對應 ${mappedCount}`} active={filter === "mapped"} onClick={() => setFilter("mapped")} color="emerald" />
      </div>

      {/* List */}
      <div className="px-4 py-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            {filter === "unmapped" ? "所有品項都已對應！" : "沒有符合的品項"}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-400 px-1">顯示 {filtered.length} 種</p>
            {filtered.map((item) => {
              const key = makeKey(item.product_name, item.variant_name);
              const selectedProductId = mappings[key] ?? item.product_id;
              const selectedProduct = getProductById(selectedProductId);
              const isExpanded = expandedKey === key;

              return (
                <div key={key}>
                  <div
                    className={`bg-white rounded-xl p-3 shadow-sm border transition-all cursor-pointer ${
                      isExpanded
                        ? "border-blue-400 ring-2 ring-blue-100"
                        : selectedProduct
                        ? "border-emerald-200"
                        : "border-amber-200"
                    }`}
                    onClick={() => setExpandedKey(isExpanded ? null : key)}
                  >
                    {/* Shopee product info */}
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-xs font-medium text-slate-800 leading-tight">
                          {item.product_name.length > 50
                            ? item.product_name.slice(0, 50) + "..."
                            : item.product_name}
                        </h3>
                        {item.variant_name && (
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                            {item.variant_name}
                          </p>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 flex-shrink-0 bg-slate-100 px-1.5 py-0.5 rounded">
                        {item.count}x
                      </span>
                    </div>

                    {/* Current mapping */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400">→</span>
                      {selectedProduct ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                            {selectedProduct.product_name}
                          </span>
                          {selectedProduct.variant_name && (
                            <span className="text-[10px] text-slate-500">
                              {selectedProduct.variant_name}
                            </span>
                          )}
                          {selectedProduct.sku && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              {selectedProduct.sku.length > 20
                                ? selectedProduct.sku.slice(0, 20) + "..."
                                : selectedProduct.sku}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-amber-500 italic">
                          點擊選擇對應商品
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Expanded: Product picker */}
                  {isExpanded && (
                    <div className="bg-blue-50 border border-blue-200 rounded-b-xl px-3 py-3 -mt-1 space-y-2">
                      <input
                        type="text"
                        placeholder="搜尋商品名稱、SKU..."
                        value={searchTerms[key] || ""}
                        onChange={(e) =>
                          setSearchTerms((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        className="w-full px-2.5 py-2 bg-white border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-300"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {/* Clear mapping option */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMapping(item, null);
                          }}
                          className="w-full text-left px-2 py-1.5 rounded text-xs text-red-500 hover:bg-red-50 active:bg-red-100"
                        >
                          × 取消對應
                        </button>

                        {getFilteredProducts(searchTerms[key] || "").map((p) => (
                          <button
                            key={p.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMapping(item, p.id);
                            }}
                            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                              selectedProductId === p.id
                                ? "bg-emerald-100 text-emerald-800 font-medium"
                                : "hover:bg-slate-100 active:bg-slate-200"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <span className="font-medium">{p.product_name}</span>
                                {p.variant_name && (
                                  <span className="text-slate-500 ml-1">| {p.variant_name}</span>
                                )}
                              </div>
                              <div className="flex-shrink-0 text-right text-slate-400">
                                {p.selling_price ? `$${p.selling_price}` : ""}
                              </div>
                            </div>
                            {p.sku && (
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                                {p.sku}
                              </div>
                            )}
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
    </div>
  );
}

const FILTER_STYLES: Record<string, { active: string; inactive: string }> = {
  default: { active: "bg-slate-800 text-white", inactive: "bg-slate-100 text-slate-600" },
  amber: { active: "bg-amber-500 text-white", inactive: "bg-amber-50 text-amber-700" },
  emerald: { active: "bg-emerald-500 text-white", inactive: "bg-emerald-50 text-emerald-700" },
};

function FilterTab({ label, active, onClick, color }: {
  label: string; active: boolean; onClick: () => void; color?: string;
}) {
  const style = FILTER_STYLES[color || "default"] || FILTER_STYLES.default;
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active ? style.active : style.inactive
      }`}
    >
      {label}
    </button>
  );
}
