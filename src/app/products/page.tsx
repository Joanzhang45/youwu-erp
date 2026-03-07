"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { Product } from "@/lib/database.types";

const CATEGORIES = [
  "全部",
  "收納好物",
  "餐廚區",
  "浴廁區",
  "床寢區",
  "燈具",
  "玄關/穿鞋區",
  "衣物區",
  "布置小物",
];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  測品: { label: "測品", color: "bg-blue-100 text-blue-700" },
  testing: { label: "測品", color: "bg-blue-100 text-blue-700" },
  常駐: { label: "常駐", color: "bg-emerald-100 text-emerald-700" },
  停售: { label: "停售", color: "bg-slate-100 text-slate-500" },
};

const POSITIONING_LABELS: Record<string, { label: string; color: string }> = {
  引流款: { label: "引流", color: "bg-purple-100 text-purple-700" },
  一般款: { label: "一般", color: "bg-slate-100 text-slate-600" },
  利潤款: { label: "利潤", color: "bg-amber-100 text-amber-700" },
};

type SortKey = "product_name" | "selling_price" | "stock_qty" | "unit_cost_ntd" | "gross_margin";
type SortDir = "asc" | "desc";

export default function ProductsPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [saving, setSaving] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("product_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<Partial<Product>>({
    product_status: "測品",
    product_positioning: "一般款",
  });

  const fetchProducts = useCallback(async () => {
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

  const filtered = products
    .filter((p) => {
      const matchSearch =
        !search ||
        p.product_name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku?.toLowerCase().includes(search.toLowerCase()) ||
        p.variant_name?.toLowerCase().includes(search.toLowerCase());
      const matchCategory =
        category === "全部" ||
        (p.category && p.category.includes(category.replace("布置小物", "布置小物")));
      return matchSearch && matchCategory;
    })
    .sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "product_name" ? "asc" : "desc");
    }
  };

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setEditForm({
      selling_price: p.selling_price,
      purchase_price_cny: p.purchase_price_cny,
      unit_cost_ntd: p.unit_cost_ntd,
      weight_kg: p.weight_kg,
      safety_stock: p.safety_stock,
      product_status: p.product_status,
      product_positioning: p.product_positioning,
      notes: p.notes,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const { error: err } = await getSupabase()
        .from("products")
        .update(editForm)
        .eq("id", editingId);
      if (err) throw err;
      setEditingId(null);
      fetchProducts();
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const createProduct = async () => {
    if (!addForm.product_name?.trim()) {
      toast("請輸入商品名稱", "error");
      return;
    }
    setSaving(true);
    try {
      const { error: err } = await getSupabase()
        .from("products")
        .insert({
          product_name: addForm.product_name.trim(),
          sku: addForm.sku || null,
          category: addForm.category || null,
          variant_name: addForm.variant_name || null,
          selling_price: addForm.selling_price || null,
          purchase_price_cny: addForm.purchase_price_cny || null,
          unit_cost_ntd: addForm.unit_cost_ntd || null,
          weight_kg: addForm.weight_kg || null,
          safety_stock: addForm.safety_stock || null,
          product_status: addForm.product_status || "測品",
          product_positioning: addForm.product_positioning || "一般款",
          notes: addForm.notes || null,
        });
      if (err) throw err;
      setShowAdd(false);
      setAddForm({ product_status: "測品", product_positioning: "一般款" });
      fetchProducts();
    } catch (e) {
      toast(e instanceof Error ? e.message : "新增失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const SortButton = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      onClick={() => handleSort(k)}
      className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
        sortKey === k
          ? "bg-slate-700 text-white"
          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
      }`}
    >
      {label} {sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </button>
  );

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <Link href="/" className="text-blue-500 underline">返回首頁</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/" className="text-xl">&larr;</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold">商品資訊</h1>
          <p className="text-xs text-slate-300">共 {products.length} 項商品</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="w-9 h-9 rounded-full bg-blue-500 text-white text-xl font-bold flex items-center justify-center hover:bg-blue-600 active:scale-95 transition-all"
        >
          {showAdd ? "×" : "+"}
        </button>
      </header>

      {/* Quick Nav */}
      <div className="px-4 py-2 bg-white border-b">
        <Link
          href="/products/mapping"
          className="block w-full py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium border border-amber-200 text-center active:bg-amber-100"
        >
          🔗 蝦皮商品對應 (訂單 → 商品主檔)
        </Link>
      </div>

      {/* Add Product Form */}
      {showAdd && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-4 space-y-3">
          <h2 className="text-sm font-bold text-blue-800">新增商品</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] text-slate-500 mb-0.5">商品名稱 *</label>
              <input
                type="text"
                value={addForm.product_name || ""}
                onChange={(e) => setAddForm({ ...addForm, product_name: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="例：矽藻土杯墊"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">SKU</label>
              <input
                type="text"
                value={addForm.sku || ""}
                onChange={(e) => setAddForm({ ...addForm, sku: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="YW-..."
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">款式名稱</label>
              <input
                type="text"
                value={addForm.variant_name || ""}
                onChange={(e) => setAddForm({ ...addForm, variant_name: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="例：圓形-大理石紋"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">分類</label>
              <select
                value={addForm.category || ""}
                onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="">請選擇</option>
                {CATEGORIES.filter((c) => c !== "全部").map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">售價 (NTD)</label>
              <input
                type="number"
                value={addForm.selling_price ?? ""}
                onChange={(e) => setAddForm({ ...addForm, selling_price: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">進貨價 (CNY)</label>
              <input
                type="number"
                value={addForm.purchase_price_cny ?? ""}
                onChange={(e) => setAddForm({ ...addForm, purchase_price_cny: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">重量 (kg)</label>
              <input
                type="number"
                step="0.001"
                value={addForm.weight_kg ?? ""}
                onChange={(e) => setAddForm({ ...addForm, weight_kg: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">安全庫存</label>
              <input
                type="number"
                value={addForm.safety_stock ?? ""}
                onChange={(e) => setAddForm({ ...addForm, safety_stock: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">商品狀態</label>
              <select
                value={addForm.product_status || "測品"}
                onChange={(e) => setAddForm({ ...addForm, product_status: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="測品">測品</option>
                <option value="常駐">常駐</option>
                <option value="停售">停售</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">產品定位</label>
              <select
                value={addForm.product_positioning || "一般款"}
                onChange={(e) => setAddForm({ ...addForm, product_positioning: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="引流款">引流款</option>
                <option value="一般款">一般款</option>
                <option value="利潤款">利潤款</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={createProduct}
              disabled={saving}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "新增中..." : "新增商品"}
            </button>
            <button
              onClick={() => { setShowAdd(false); setAddForm({ product_status: "測品", product_positioning: "一般款" }); }}
              className="flex-1 py-2 rounded-lg bg-slate-200 text-slate-600 text-sm font-medium active:bg-slate-300"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b overflow-x-auto">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              category === cat
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Search + Sort */}
      <div className="px-4 py-2 bg-white border-b sticky top-[52px] z-20">
        <input
          type="text"
          placeholder="搜尋商品名稱、SKU、款式..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 bg-slate-100 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-300 mb-2"
        />
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-[10px] text-slate-400 leading-6">排序:</span>
          <SortButton k="product_name" label="名稱" />
          <SortButton k="selling_price" label="售價" />
          <SortButton k="stock_qty" label="庫存" />
          <SortButton k="unit_cost_ntd" label="成本" />
          <SortButton k="gross_margin" label="毛利率" />
        </div>
      </div>

      {/* Product List */}
      <div className="px-4 py-2">
        {loading ? (
          <div className="text-center py-12 text-slate-400">載入中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">沒有符合的商品</div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-400 px-1">顯示 {filtered.length} 項</p>
            {filtered.map((p) => (
              <div key={p.id}>
                <ProductCard
                  product={p}
                  onEdit={() => startEdit(p)}
                  isEditing={editingId === p.id}
                />
                {editingId === p.id && (
                  <EditPanel
                    form={editForm}
                    setForm={setEditForm}
                    onSave={saveEdit}
                    onCancel={() => setEditingId(null)}
                    saving={saving}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCard({
  product: p,
  onEdit,
  isEditing,
}: {
  product: Product;
  onEdit: () => void;
  isEditing: boolean;
}) {
  const status = STATUS_LABELS[p.product_status || ""] || {
    label: p.product_status || "—",
    color: "bg-slate-100 text-slate-500",
  };
  const positioning = POSITIONING_LABELS[p.product_positioning || ""];
  const margin = p.gross_margin != null ? (p.gross_margin * 100).toFixed(1) : null;
  const isLow = p.safety_stock != null && p.stock_qty > 0 && p.stock_qty <= p.safety_stock;
  const isOut = p.stock_qty <= 0;

  return (
    <div
      className={`bg-white rounded-xl p-3 shadow-sm border cursor-pointer transition-all ${
        isEditing
          ? "border-blue-400 ring-2 ring-blue-100"
          : isOut
          ? "border-red-200"
          : isLow
          ? "border-amber-200"
          : "border-slate-200 hover:border-slate-300"
      }`}
      onClick={onEdit}
    >
      <div className="flex gap-3">
        {/* Image */}
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
            {p.category?.includes("燈") ? "💡" : p.category?.includes("廚") ? "🍳" : "📦"}
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
            <div className="flex-shrink-0 text-right">
              <div className="text-base font-bold">
                {p.selling_price ? `$${p.selling_price}` : "—"}
              </div>
              <div className={`text-[10px] ${isOut ? "text-red-500" : isLow ? "text-amber-500" : "text-slate-400"}`}>
                庫存 {p.stock_qty}
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${status.color}`}>
              {status.label}
            </span>
            {positioning && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${positioning.color}`}>
                {positioning.label}
              </span>
            )}
            {p.category && (
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">
                {p.category.length > 4 ? p.category.slice(0, 4) + "…" : p.category}
              </span>
            )}
            {p.unit_cost_ntd != null && (
              <span className="text-[10px] text-slate-400">
                成本 ${p.unit_cost_ntd.toFixed(0)}
              </span>
            )}
            {margin != null && (
              <span className={`text-[10px] ${Number(margin) >= 40 ? "text-emerald-600" : Number(margin) >= 20 ? "text-amber-600" : "text-red-500"}`}>
                毛利 {margin}%
              </span>
            )}
          </div>

          {/* SKU */}
          {p.sku && (
            <p className="text-[10px] text-slate-400 font-mono mt-1 truncate">{p.sku}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function EditPanel({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
}: {
  form: Partial<Product>;
  setForm: (f: Partial<Product>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const Field = ({
    label,
    field,
    type = "number",
    suffix,
  }: {
    label: string;
    field: keyof Product;
    type?: string;
    suffix?: string;
  }) => (
    <div>
      <label className="block text-[11px] text-slate-500 mb-0.5">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type={type}
          value={form[field] ?? ""}
          onChange={(e) =>
            setForm({
              ...form,
              [field]: type === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value,
            })
          }
          className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
        />
        {suffix && <span className="text-[11px] text-slate-400 flex-shrink-0">{suffix}</span>}
      </div>
    </div>
  );

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-b-xl px-4 py-3 -mt-1 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="售價" field="selling_price" suffix="NTD" />
        <Field label="進貨價" field="purchase_price_cny" suffix="CNY" />
        <Field label="單品成本" field="unit_cost_ntd" suffix="NTD" />
        <Field label="重量" field="weight_kg" suffix="kg" />
        <Field label="安全庫存" field="safety_stock" />
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">商品狀態</label>
          <select
            value={form.product_status || ""}
            onChange={(e) => setForm({ ...form, product_status: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="測品">測品</option>
            <option value="常駐">常駐</option>
            <option value="停售">停售</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">產品定位</label>
          <select
            value={form.product_positioning || ""}
            onChange={(e) => setForm({ ...form, product_positioning: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="引流款">引流款</option>
            <option value="一般款">一般款</option>
            <option value="利潤款">利潤款</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-[11px] text-slate-500 mb-0.5">備註</label>
        <input
          type="text"
          value={form.notes || ""}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
          placeholder="備註..."
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "儲存中..." : "儲存"}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg bg-slate-200 text-slate-600 text-sm font-medium active:bg-slate-300"
        >
          取消
        </button>
      </div>
    </div>
  );
}
