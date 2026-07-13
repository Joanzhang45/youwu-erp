"use client";

// 商品詳情／編輯（M4 第三批 /catalog?id=）。static export 無動態路由，走 query param——
// 同 /inbound?id= 的既有慣例（PurchaseOrderTimeline.tsx）。編輯欄位沿用舊 /products 頁
// EditPanel 能力：售價／進貨價／單品成本／重量／安全庫存／狀態／定位／備註，寫入對象一律
// 是 products 表本身（非 v_products_with_stock），stock_qty／gross_margin 等計算欄位禁入 payload。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { Product } from "@/lib/database.types";
import { ChevronRightIcon, CheckIcon } from "./icons";

const STATUS_OPTIONS = ["測品", "常駐", "停售"];
const POSITIONING_OPTIONS = ["引流款", "一般款", "利潤款"];

type EditForm = {
  selling_price: number | null;
  purchase_price_cny: number | null;
  unit_cost_ntd: number | null;
  weight_kg: number | null;
  safety_stock: number | null;
  product_status: string | null;
  product_positioning: string | null;
  notes: string | null;
};

function toEditForm(p: Product): EditForm {
  return {
    selling_price: p.selling_price,
    purchase_price_cny: p.purchase_price_cny,
    unit_cost_ntd: p.unit_cost_ntd,
    weight_kg: p.weight_kg,
    safety_stock: p.safety_stock,
    product_status: p.product_status,
    product_positioning: p.product_positioning,
    notes: p.notes,
  };
}

export function ProductDetail({ id }: { id: number }) {
  const { toast } = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.from("v_products_with_stock").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) {
        setNotFound(true);
      } else {
        setProduct(data);
        setForm(toEditForm(data));
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  const handleSave = async () => {
    if (!form || !product) return;
    setSaving(true);
    try {
      const { error } = await getSupabase().from("products").update(form).eq("id", product.id);
      if (error) throw error;
      toast("已儲存");
      fetchProduct();
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-[#8F8F8F] text-sm">載入中...</div>;
  }

  if (notFound || !product || !form) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-sm text-[#8F8F8F]">找不到這個商品</p>
        <Link href="/catalog" className="text-[#0070F3] text-sm underline">
          返回商品列表
        </Link>
      </div>
    );
  }

  const margin = product.gross_margin != null ? (product.gross_margin * 100).toFixed(1) : null;
  const isOut = product.stock_qty <= 0;
  const isLow = !isOut && product.safety_stock != null && product.stock_qty <= product.safety_stock;

  return (
    <div className="min-h-screen bg-white">
      <header className="px-5 pt-6 pb-2 max-w-2xl mx-auto">
        <Link href="/catalog" className="inline-flex items-center gap-1 text-sm text-[#8F8F8F] hover:text-[#171717] transition-colors duration-150">
          <ChevronRightIcon className="w-4 h-4 rotate-180" />
          返回商品列表
        </Link>
      </header>

      <main className="px-5 max-w-2xl mx-auto pb-10 app-fade-up-enter">
        <section className="rounded-2xl border border-[#EAEAEA] p-4 mb-4 mt-3">
          <div className="flex gap-4">
            {product.product_image ? (
              <img
                src={product.product_image}
                alt={product.product_name}
                className="w-20 h-20 rounded-xl object-cover bg-[#FAFAFA] flex-shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-[#FAFAFA] flex items-center justify-center flex-shrink-0 text-2xl">📦</div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold text-[#171717] leading-tight">{product.product_name}</h1>
              {product.variant_name && <p className="text-sm text-[#8F8F8F] mt-0.5">{product.variant_name}</p>}
              {product.sku && <p className="text-xs text-[#8F8F8F] font-mono mt-1 truncate">{product.sku}</p>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-[#EAEAEA]">
            <div>
              <p className={`text-lg font-semibold tabular-nums ${isOut ? "text-[#E00]" : isLow ? "text-[#F5A623]" : "text-[#171717]"}`}>
                {product.stock_qty.toLocaleString()}
              </p>
              <p className="text-[11px] text-[#8F8F8F]">現貨庫存</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-[#171717] tabular-nums">{product.total_sold_qty.toLocaleString()}</p>
              <p className="text-[11px] text-[#8F8F8F]">已售數量</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-[#171717] tabular-nums">{margin != null ? `${margin}%` : "—"}</p>
              <p className="text-[11px] text-[#8F8F8F]">預估毛利率</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#EAEAEA] p-4 space-y-3">
          <p className="text-xs font-medium text-[#8F8F8F]">編輯</p>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="售價（NTD）" value={form.selling_price} onChange={(v) => setForm({ ...form, selling_price: v })} />
            <NumberField label="進貨價（CNY）" value={form.purchase_price_cny} onChange={(v) => setForm({ ...form, purchase_price_cny: v })} />
            <NumberField label="單品成本（NTD）" value={form.unit_cost_ntd} onChange={(v) => setForm({ ...form, unit_cost_ntd: v })} />
            <NumberField label="重量（kg）" value={form.weight_kg} onChange={(v) => setForm({ ...form, weight_kg: v })} />
            <NumberField label="安全庫存" value={form.safety_stock} onChange={(v) => setForm({ ...form, safety_stock: v })} />
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">商品狀態</label>
              <select
                value={form.product_status || ""}
                onChange={(e) => setForm({ ...form, product_status: e.target.value })}
                className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150 bg-white"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">產品定位</label>
              <select
                value={form.product_positioning || ""}
                onChange={(e) => setForm({ ...form, product_positioning: e.target.value })}
                className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150 bg-white"
              >
                {POSITIONING_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">備註</label>
            <input
              type="text"
              value={form.notes || ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
              placeholder="選填"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? "儲存中..." : (
              <>
                <CheckIcon className="w-4 h-4" />
                儲存變更
              </>
            )}
          </button>
        </section>
      </main>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[#171717] mb-1">{label}</label>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
      />
    </div>
  );
}
