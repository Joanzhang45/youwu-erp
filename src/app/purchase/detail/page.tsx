"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import type { PurchaseOrder, PurchaseOrderItem } from "@/lib/database.types";

type ProductOption = {
  id: number;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  purchase_price_cny: number | null;
  weight_kg: number | null;
  product_image: string | null;
};

const STATUS_STEPS = [
  { key: "status_draft", label: "草稿" },
  { key: "status_confirmed", label: "確認" },
  { key: "status_ordered", label: "已下單" },
  { key: "status_paid", label: "已付款" },
  { key: "status_shipping", label: "運送中" },
  { key: "status_warehouse_received", label: "集運倉收" },
  { key: "status_warehouse_stored", label: "已入倉" },
  { key: "status_return_shipping", label: "回運中" },
  { key: "status_received", label: "已到貨" },
] as const;

export default function PurchaseDetailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-400">載入中...</div>}>
      <PurchaseDetailContent />
    </Suspense>
  );
}

function PurchaseDetailContent() {
  const searchParams = useSearchParams();
  const poId = Number(searchParams.get("id"));

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add item form
  const [showAddItem, setShowAddItem] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
  const [itemQty, setItemQty] = useState(1);
  const [itemPrice, setItemPrice] = useState<number | "">("");
  const [itemShipping, setItemShipping] = useState<number | "">(0);
  const [savingItem, setSavingItem] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [poRes, itemsRes, productsRes] = await Promise.all([
        getSupabase().from("purchase_orders").select("*").eq("id", poId).single(),
        getSupabase().from("purchase_order_items").select("*").eq("po_id", poId).order("created_at"),
        getSupabase().from("products").select("id,product_name,variant_name,sku,purchase_price_cny,weight_kg,product_image").order("product_name"),
      ]);
      if (poRes.error) throw poRes.error;
      if (itemsRes.error) throw itemsRes.error;
      if (productsRes.error) throw productsRes.error;
      setPo(poRes.data);
      setItems(itemsRes.data || []);
      setProducts(productsRes.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const advanceStatus = async () => {
    if (!po) return;
    // Find current step index
    let currentIdx = -1;
    for (let i = STATUS_STEPS.length - 1; i >= 0; i--) {
      if (po[STATUS_STEPS[i].key as keyof PurchaseOrder]) {
        currentIdx = i;
        break;
      }
    }
    const nextIdx = currentIdx + 1;
    if (nextIdx >= STATUS_STEPS.length) return;

    const nextKey = STATUS_STEPS[nextIdx].key;
    const { error: err } = await getSupabase()
      .from("purchase_orders")
      .update({ [nextKey]: true })
      .eq("id", poId);
    if (err) {
      alert(err.message);
      return;
    }
    fetchData();
  };

  const addItem = async () => {
    if (!selectedProduct || itemQty <= 0) return;
    setSavingItem(true);
    try {
      const unitPrice = itemPrice || selectedProduct.purchase_price_cny || 0;
      const { error: err } = await getSupabase()
        .from("purchase_order_items")
        .insert({
          po_id: poId,
          product_id: selectedProduct.id,
          product_name: selectedProduct.product_name,
          variant_name: selectedProduct.variant_name || null,
          product_image: selectedProduct.product_image || null,
          qty: itemQty,
          unit_price_cny: unitPrice,
          subtotal_cny: unitPrice * itemQty,
          weight_kg: selectedProduct.weight_kg ? selectedProduct.weight_kg * itemQty : null,
          domestic_shipping_cny: itemShipping || null,
        });
      if (err) throw err;

      // Update PO subtotal
      const newSubtotal = items.reduce((sum, i) => sum + (Number(i.subtotal_cny) || 0), 0) + unitPrice * itemQty;
      await getSupabase()
        .from("purchase_orders")
        .update({ subtotal_cny: newSubtotal })
        .eq("id", poId);

      setShowAddItem(false);
      setSelectedProduct(null);
      setItemSearch("");
      setItemQty(1);
      setItemPrice("");
      setItemShipping(0);
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setSavingItem(false);
    }
  };

  const removeItem = async (itemId: number) => {
    if (!confirm("確定刪除此品項？")) return;
    const { error: err } = await getSupabase()
      .from("purchase_order_items")
      .delete()
      .eq("id", itemId);
    if (err) {
      alert(err.message);
      return;
    }
    fetchData();
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">載入中...</div>;
  }

  if (error || !po) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error || "找不到採購單"}</p>
          <Link href="/purchase" className="text-blue-500 underline">返回列表</Link>
        </div>
      </div>
    );
  }

  // Current status
  let currentStepIdx = -1;
  for (let i = STATUS_STEPS.length - 1; i >= 0; i--) {
    if (po[STATUS_STEPS[i].key as keyof PurchaseOrder]) {
      currentStepIdx = i;
      break;
    }
  }
  const currentStatus = currentStepIdx >= 0 ? STATUS_STEPS[currentStepIdx].label : "草稿";
  const canAdvance = !po.status_cancelled && currentStepIdx < STATUS_STEPS.length - 1;
  const nextStatus = canAdvance ? STATUS_STEPS[currentStepIdx + 1].label : null;

  const totalCny = items.reduce((sum, i) => sum + (Number(i.subtotal_cny) || 0), 0);
  const totalWeight = items.reduce((sum, i) => sum + (Number(i.weight_kg) || 0), 0);

  // Product search for add item
  const searchResults = itemSearch.length >= 1
    ? products.filter((p) =>
        p.product_name.toLowerCase().includes(itemSearch.toLowerCase()) ||
        p.sku?.toLowerCase().includes(itemSearch.toLowerCase()) ||
        p.variant_name?.toLowerCase().includes(itemSearch.toLowerCase())
      ).slice(0, 8)
    : [];

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/purchase" className="text-xl">&larr;</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold">{po.po_number}</h1>
          <p className="text-xs text-slate-300">{po.order_date || "未設定日期"}</p>
        </div>
      </header>

      {/* Status Progress */}
      <div className="px-4 py-3 bg-white border-b">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {STATUS_STEPS.map((step, idx) => {
            const done = idx <= currentStepIdx;
            const isCurrent = idx === currentStepIdx;
            return (
              <div key={step.key} className="flex items-center flex-shrink-0">
                <div
                  className={`text-[10px] px-2 py-1 rounded-full font-medium transition-colors ${
                    isCurrent
                      ? "bg-blue-600 text-white"
                      : done
                      ? "bg-blue-100 text-blue-700"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {step.label}
                </div>
                {idx < STATUS_STEPS.length - 1 && (
                  <div className={`w-3 h-0.5 ${done ? "bg-blue-300" : "bg-slate-200"}`} />
                )}
              </div>
            );
          })}
        </div>
        {canAdvance && (
          <button
            onClick={advanceStatus}
            className="mt-2 w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700"
          >
            推進到「{nextStatus}」
          </button>
        )}
      </div>

      {/* PO Info */}
      <div className="px-4 py-3 bg-white border-b">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <InfoRow label="採購人" value={po.purchaser} />
          <InfoRow label="付款方式" value={po.payment_method} />
          <InfoRow label="集運商" value={po.forwarder} />
          <InfoRow label="匯率" value={po.cny_rate ? `${po.cny_rate}` : null} />
          <InfoRow label="集運費率" value={po.shipping_rate_per_kg ? `${po.shipping_rate_per_kg} TWD/kg` : null} />
          {po.notes && <div className="col-span-2 text-[11px] text-slate-400">備註: {po.notes}</div>}
        </div>
      </div>

      {/* Summary Bar */}
      <div className="px-4 py-2 bg-slate-50 border-b flex items-center justify-between text-sm">
        <span className="text-slate-500">合計</span>
        <div className="flex gap-4">
          <span className="text-slate-600">{items.length} 品項</span>
          <span className="font-medium">&yen;{totalCny.toFixed(2)}</span>
          <span className="text-slate-500">{totalWeight.toFixed(2)} kg</span>
          {po.cny_rate && (
            <span className="text-slate-700 font-medium">
              &asymp; ${(totalCny * po.cny_rate).toFixed(0)} TWD
            </span>
          )}
        </div>
      </div>

      {/* Items Section */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-slate-700">採購品項</h2>
          <button
            onClick={() => setShowAddItem(!showAddItem)}
            className="text-xs px-3 py-1 rounded-full bg-blue-500 text-white font-medium active:bg-blue-600"
          >
            {showAddItem ? "取消" : "+ 加入商品"}
          </button>
        </div>

        {/* Add Item Form */}
        {showAddItem && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3 space-y-2">
            {/* Product Search */}
            {!selectedProduct ? (
              <div>
                <input
                  type="text"
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="搜尋商品名稱、SKU..."
                  autoFocus
                />
                {searchResults.length > 0 && (
                  <div className="mt-1 border rounded-lg bg-white max-h-48 overflow-y-auto">
                    {searchResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedProduct(p);
                          setItemPrice(p.purchase_price_cny || "");
                          setItemSearch("");
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-0 flex items-center gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{p.product_name}</div>
                          {p.variant_name && <div className="text-[11px] text-slate-400 truncate">{p.variant_name}</div>}
                        </div>
                        {p.purchase_price_cny && (
                          <span className="text-[11px] text-slate-500 flex-shrink-0">&yen;{p.purchase_price_cny}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between bg-white rounded-lg p-2 border mb-2">
                  <div>
                    <div className="text-sm font-medium">{selectedProduct.product_name}</div>
                    {selectedProduct.variant_name && (
                      <div className="text-[11px] text-slate-400">{selectedProduct.variant_name}</div>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedProduct(null)}
                    className="text-xs text-slate-400 px-2"
                  >
                    換
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-500">數量</label>
                    <input
                      type="number"
                      value={itemQty}
                      onChange={(e) => setItemQty(Math.max(1, Number(e.target.value)))}
                      className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                      min={1}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500">單價 (CNY)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={itemPrice}
                      onChange={(e) => setItemPrice(e.target.value ? Number(e.target.value) : "")}
                      className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500">境內運費</label>
                    <input
                      type="number"
                      step="0.1"
                      value={itemShipping}
                      onChange={(e) => setItemShipping(e.target.value ? Number(e.target.value) : "")}
                      className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] text-slate-500">
                    小計: &yen;{((Number(itemPrice) || 0) * itemQty).toFixed(2)}
                  </span>
                  <button
                    onClick={addItem}
                    disabled={savingItem}
                    className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50"
                  >
                    {savingItem ? "新增中..." : "加入"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Item List */}
        {items.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">尚無品項，點「加入商品」開始</div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="bg-white rounded-xl p-3 border border-slate-200 flex gap-3">
                {item.product_image ? (
                  <img src={item.product_image} alt="" className="w-12 h-12 rounded-lg object-cover bg-slate-100 flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 text-lg">
                    📦
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-sm font-medium truncate">{item.product_name}</h4>
                      {item.variant_name && (
                        <p className="text-[11px] text-slate-400 truncate">{item.variant_name}</p>
                      )}
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-slate-300 hover:text-red-500 text-xs flex-shrink-0"
                    >
                      刪除
                    </button>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                    <span>x{item.qty}</span>
                    <span>&yen;{item.unit_price_cny}/件</span>
                    <span className="font-medium text-slate-700">&yen;{Number(item.subtotal_cny).toFixed(2)}</span>
                    {item.weight_kg && <span>{Number(item.weight_kg).toFixed(2)}kg</span>}
                    {item.domestic_shipping_cny && <span>運費 &yen;{Number(item.domestic_shipping_cny)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-[11px] text-slate-400">{label}</span>
      <p className="text-sm">{value}</p>
    </div>
  );
}
