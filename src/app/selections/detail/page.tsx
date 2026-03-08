"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import type { ProductSelection, ProductVariant, CompetitorProduct } from "@/lib/database.types";

const STATUS_OPTIONS = ["考慮中", "測品", "預購", "已下單", "已通過", "不進貨", "已放棄"];

export default function SelectionDetailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-400">載入中...</div>}>
      <SelectionDetailContent />
    </Suspense>
  );
}

function SelectionDetailContent() {
  const searchParams = useSearchParams();
  const selId = Number(searchParams.get("id"));
  const { toast } = useToast();
  const { confirm } = useConfirm();

  const [selection, setSelection] = useState<ProductSelection | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<ProductSelection>>({});
  const [saving, setSaving] = useState(false);

  // Variant form
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [variantForm, setVariantForm] = useState({
    variant_name: "", purchase_price_cny: 0, selling_price_ntd: 0,
    weight_kg: 0, domestic_shipping_cny: 0, qty: 0,
  });

  // Variant edit
  const [editingVariantId, setEditingVariantId] = useState<number | null>(null);
  const [variantEditForm, setVariantEditForm] = useState({
    purchase_price_cny: 0, selling_price_ntd: 0, weight_kg: 0,
    domestic_shipping_cny: 0, qty: 0,
  });

  // Competitor form
  const [showAddCompetitor, setShowAddCompetitor] = useState(false);
  const [competitorForm, setCompetitorForm] = useState({
    competitor_name: "", competitor_price: 0, competitor_link: "", notes: "",
  });

  const fetchData = useCallback(async () => {
    if (!selId) return;
    try {
      setLoading(true);
      const [selRes, varRes, compRes] = await Promise.all([
        getSupabase().from("product_selections").select("*").eq("id", selId).single(),
        getSupabase().from("product_variants").select("*").eq("selection_id", selId).order("created_at"),
        getSupabase().from("competitor_products").select("*").eq("selection_id", selId),
      ]);
      if (selRes.error) throw selRes.error;
      setSelection(selRes.data);
      setVariants(varRes.data || []);
      setCompetitors(compRes.data || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, [selId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const startEdit = () => {
    if (!selection) return;
    setEditForm({
      product_name: selection.product_name,
      category: selection.category,
      status: selection.status,
      cny_rate: selection.cny_rate,
      shipping_method: selection.shipping_method,
      shipping_rate_per_kg: selection.shipping_rate_per_kg,
      domestic_shipping_cny: selection.domestic_shipping_cny,
      order_link: selection.order_link,
      sales_mode: selection.sales_mode,
      notes: selection.notes,
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selection) return;
    setSaving(true);
    try {
      const { error: err } = await getSupabase()
        .from("product_selections")
        .update(editForm)
        .eq("id", selection.id);
      if (err) throw err;
      toast("儲存成功", "success");
      setEditing(false);
      fetchData();
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const addVariant = async () => {
    if (!variantForm.variant_name.trim()) {
      toast("請輸入款式名稱", "error");
      return;
    }
    setSaving(true);
    try {
      // Calculate unit cost and profit
      const cnyRate = selection?.cny_rate || 4.6;
      const shippingRate = selection?.shipping_rate_per_kg || 0;
      const unitCostNtd = (variantForm.purchase_price_cny + variantForm.domestic_shipping_cny) * cnyRate
        + variantForm.weight_kg * shippingRate;
      const profitNtd = variantForm.selling_price_ntd - unitCostNtd;
      const marginPct = variantForm.selling_price_ntd > 0
        ? (profitNtd / variantForm.selling_price_ntd) * 100
        : 0;

      const { error: err } = await getSupabase()
        .from("product_variants")
        .insert({
          selection_id: selId,
          variant_name: variantForm.variant_name.trim(),
          purchase_price_cny: variantForm.purchase_price_cny || null,
          selling_price_ntd: variantForm.selling_price_ntd || null,
          weight_kg: variantForm.weight_kg || null,
          domestic_shipping_cny: variantForm.domestic_shipping_cny || null,
          qty: variantForm.qty || null,
          unit_cost_ntd: Math.round(unitCostNtd * 100) / 100,
          profit_ntd: Math.round(profitNtd * 100) / 100,
          margin_pct: Math.round(marginPct * 10) / 10,
        });
      if (err) throw err;
      toast("款式新增成功", "success");
      setShowAddVariant(false);
      setVariantForm({ variant_name: "", purchase_price_cny: 0, selling_price_ntd: 0, weight_kg: 0, domestic_shipping_cny: 0, qty: 0 });
      fetchData();
      recalcTotals();
    } catch (e) {
      toast(e instanceof Error ? e.message : "新增失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteVariant = async (id: number) => {
    const ok = await confirm({ title: "刪除款式", message: "確定要刪除此款式？", confirmText: "刪除", danger: true });
    if (!ok) return;
    try {
      const { error: err } = await getSupabase().from("product_variants").delete().eq("id", id);
      if (err) throw err;
      toast("已刪除", "success");
      fetchData();
      recalcTotals();
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除失敗", "error");
    }
  };

  const startEditVariant = (v: ProductVariant) => {
    setEditingVariantId(v.id);
    setVariantEditForm({
      purchase_price_cny: v.purchase_price_cny || 0,
      selling_price_ntd: v.selling_price_ntd || 0,
      weight_kg: v.weight_kg || 0,
      domestic_shipping_cny: v.domestic_shipping_cny || 0,
      qty: v.qty || 0,
    });
  };

  const saveVariant = async () => {
    if (!editingVariantId || !selection) return;
    setSaving(true);
    try {
      const cnyRate = selection.cny_rate || 4.6;
      const shippingRate = selection.shipping_rate_per_kg || 0;
      const unitCostNtd = (variantEditForm.purchase_price_cny + variantEditForm.domestic_shipping_cny) * cnyRate
        + variantEditForm.weight_kg * shippingRate;
      const profitNtd = variantEditForm.selling_price_ntd - unitCostNtd;
      const marginPct = variantEditForm.selling_price_ntd > 0
        ? (profitNtd / variantEditForm.selling_price_ntd) * 100
        : 0;

      const { error: err } = await getSupabase()
        .from("product_variants")
        .update({
          purchase_price_cny: variantEditForm.purchase_price_cny || null,
          selling_price_ntd: variantEditForm.selling_price_ntd || null,
          weight_kg: variantEditForm.weight_kg || null,
          domestic_shipping_cny: variantEditForm.domestic_shipping_cny || null,
          qty: variantEditForm.qty || null,
          unit_cost_ntd: Math.round(unitCostNtd * 100) / 100,
          profit_ntd: Math.round(profitNtd * 100) / 100,
          margin_pct: Math.round(marginPct * 10) / 10,
        })
        .eq("id", editingVariantId);
      if (err) throw err;
      toast("款式已更新", "success");
      setEditingVariantId(null);
      fetchData();
      recalcTotals();
    } catch (e) {
      toast(e instanceof Error ? e.message : "更新失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const addCompetitor = async () => {
    if (!competitorForm.competitor_name.trim()) {
      toast("請輸入競品名稱", "error");
      return;
    }
    setSaving(true);
    try {
      const { error: err } = await getSupabase()
        .from("competitor_products")
        .insert({
          selection_id: selId,
          competitor_name: competitorForm.competitor_name.trim(),
          competitor_price: competitorForm.competitor_price || null,
          competitor_link: competitorForm.competitor_link || null,
          notes: competitorForm.notes || null,
        });
      if (err) throw err;
      toast("競品新增成功", "success");
      setShowAddCompetitor(false);
      setCompetitorForm({ competitor_name: "", competitor_price: 0, competitor_link: "", notes: "" });
      fetchData();
      recalcCompetitorPrices();
    } catch (e) {
      toast(e instanceof Error ? e.message : "新增失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteCompetitor = async (id: number) => {
    const ok = await confirm({ title: "刪除競品", message: "確定要刪除此競品？", confirmText: "刪除", danger: true });
    if (!ok) return;
    try {
      const { error: err } = await getSupabase().from("competitor_products").delete().eq("id", id);
      if (err) throw err;
      toast("已刪除", "success");
      fetchData();
      recalcCompetitorPrices();
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除失敗", "error");
    }
  };

  const recalcTotals = async () => {
    const { data: vars } = await getSupabase().from("product_variants").select("*").eq("selection_id", selId);
    if (!vars) return;
    const totalQty = vars.reduce((s, v) => s + (v.qty || 0), 0);
    const totalWeight = vars.reduce((s, v) => s + (v.qty || 0) * (v.weight_kg || 0), 0);
    const totalCostCny = vars.reduce((s, v) => s + (v.qty || 0) * (v.purchase_price_cny || 0), 0);
    const cnyRate = selection?.cny_rate || 4.6;
    await getSupabase().from("product_selections").update({
      total_qty: totalQty,
      total_weight_kg: Math.round(totalWeight * 1000) / 1000,
      order_amount_cny: Math.round(totalCostCny * 100) / 100,
      total_purchase_cost_ntd: Math.round(totalCostCny * cnyRate * 100) / 100,
    }).eq("id", selId);
  };

  const recalcCompetitorPrices = async () => {
    const { data: comps } = await getSupabase().from("competitor_products").select("competitor_price").eq("selection_id", selId);
    if (!comps || comps.length === 0) return;
    const prices = comps.map((c) => c.competitor_price).filter((p): p is number => p != null && p > 0);
    if (prices.length === 0) return;
    await getSupabase().from("product_selections").update({
      competitor_min_price: Math.min(...prices),
      competitor_max_price: Math.max(...prices),
    }).eq("id", selId);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">載入中...</div>;
  }

  if (!selection) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-500 mb-4">找不到此選品紀錄</p>
          <Link href="/selections" className="text-blue-500 underline">返回列表</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/selections" className="text-xl">&larr;</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold truncate">{selection.product_name || "未命名"}</h1>
          <p className="text-xs text-slate-300">{selection.selection_number}</p>
        </div>
        <button
          onClick={() => editing ? saveEdit() : startEdit()}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-medium active:bg-blue-600 disabled:opacity-50"
        >
          {saving ? "儲存中..." : editing ? "儲存" : "編輯"}
        </button>
      </header>

      {/* Selection Info */}
      <div className="px-4 py-4 bg-white border-b space-y-3">
        {editing ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] text-slate-500 mb-0.5">產品名稱</label>
              <input type="text" value={editForm.product_name || ""} onChange={(e) => setEditForm({ ...editForm, product_name: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">狀態</label>
              <select value={editForm.status || ""} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300">
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">分類</label>
              <input type="text" value={editForm.category || ""} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">匯率</label>
              <input type="number" step="0.01" value={editForm.cny_rate ?? ""} onChange={(e) => setEditForm({ ...editForm, cny_rate: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">集運費率 (TWD/kg)</label>
              <input type="number" step="0.1" value={editForm.shipping_rate_per_kg ?? ""} onChange={(e) => setEditForm({ ...editForm, shipping_rate_per_kg: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">銷售模式</label>
              <select value={editForm.sales_mode || ""} onChange={(e) => setEditForm({ ...editForm, sales_mode: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300">
                <option value="">請選擇</option>
                <option value="一般販售">一般販售</option>
                <option value="組合販售">組合販售</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-slate-500 mb-0.5">訂貨連結</label>
              <input type="text" value={editForm.order_link || ""} onChange={(e) => setEditForm({ ...editForm, order_link: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-slate-500 mb-0.5">備註</label>
              <input type="text" value={editForm.notes || ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <button onClick={() => setEditing(false)} className="col-span-2 py-2 rounded-lg bg-slate-200 text-slate-600 text-sm font-medium">取消</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <InfoRow label="狀態" value={selection.status} />
              <InfoRow label="選品日期" value={selection.selection_date} />
              <InfoRow label="分類" value={selection.category} />
              <InfoRow label="銷售模式" value={selection.sales_mode} />
              <InfoRow label="匯率" value={selection.cny_rate?.toString()} />
              <InfoRow label="集運費率" value={selection.shipping_rate_per_kg ? `${selection.shipping_rate_per_kg} TWD/kg` : null} />
              <InfoRow label="總數量" value={selection.total_qty?.toString()} />
              <InfoRow label="總重量" value={selection.total_weight_kg ? `${selection.total_weight_kg} kg` : null} />
              <InfoRow label="訂貨金額" value={selection.order_amount_cny ? `¥${selection.order_amount_cny}` : null} />
              <InfoRow label="進貨成本" value={selection.total_purchase_cost_ntd ? `$${selection.total_purchase_cost_ntd}` : null} />
            </div>
            {selection.order_link && (
              <a href={selection.order_link} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-500 underline block mt-1">訂貨連結</a>
            )}
            {selection.notes && <p className="text-xs text-slate-400 mt-1">{selection.notes}</p>}
          </>
        )}
      </div>

      {/* Summary Stats */}
      <div className="px-4 py-3 bg-slate-50 border-b">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold">{variants.length}</div>
            <div className="text-[10px] text-slate-500">款式</div>
          </div>
          <div>
            <div className="text-lg font-bold">{competitors.length}</div>
            <div className="text-[10px] text-slate-500">競品</div>
          </div>
          <div>
            <div className="text-lg font-bold">
              {selection.competitor_min_price && selection.competitor_max_price
                ? `$${selection.competitor_min_price}-${selection.competitor_max_price}`
                : "-"}
            </div>
            <div className="text-[10px] text-slate-500">競品價格帶</div>
          </div>
        </div>
      </div>

      {/* Variants Section */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold">款式 / SKU</h2>
          <button
            onClick={() => setShowAddVariant(!showAddVariant)}
            className="text-xs px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 font-medium active:bg-blue-100"
          >
            {showAddVariant ? "取消" : "+ 新增款式"}
          </button>
        </div>

        {showAddVariant && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 mb-0.5">款式名稱 *</label>
                <input type="text" value={variantForm.variant_name} onChange={(e) => setVariantForm({ ...variantForm, variant_name: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" placeholder="例：酒紅色" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">進貨價 (CNY)</label>
                <input type="number" step="0.01" value={variantForm.purchase_price_cny || ""} onChange={(e) => setVariantForm({ ...variantForm, purchase_price_cny: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">售價 (NTD)</label>
                <input type="number" step="1" value={variantForm.selling_price_ntd || ""} onChange={(e) => setVariantForm({ ...variantForm, selling_price_ntd: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">重量 (kg)</label>
                <input type="number" step="0.001" value={variantForm.weight_kg || ""} onChange={(e) => setVariantForm({ ...variantForm, weight_kg: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">數量</label>
                <input type="number" value={variantForm.qty || ""} onChange={(e) => setVariantForm({ ...variantForm, qty: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">境內運費 (CNY)</label>
                <input type="number" step="0.1" value={variantForm.domestic_shipping_cny || ""} onChange={(e) => setVariantForm({ ...variantForm, domestic_shipping_cny: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
            </div>
            <button onClick={addVariant} disabled={saving}
              className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50">
              {saving ? "新增中..." : "新增款式"}
            </button>
          </div>
        )}

        {variants.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">尚未新增款式</p>
        ) : (
          <div className="space-y-2">
            {variants.map((v) => (
              <div key={v.id} className="bg-white rounded-xl p-3 shadow-sm border border-slate-200">
                {editingVariantId === v.id ? (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">{v.variant_name}</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">進貨價 (CNY)</label>
                        <input type="number" step="0.01" value={variantEditForm.purchase_price_cny || ""} onChange={(e) => setVariantEditForm({ ...variantEditForm, purchase_price_cny: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">售價 (NTD)</label>
                        <input type="number" step="1" value={variantEditForm.selling_price_ntd || ""} onChange={(e) => setVariantEditForm({ ...variantEditForm, selling_price_ntd: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">重量 (kg)</label>
                        <input type="number" step="0.001" value={variantEditForm.weight_kg || ""} onChange={(e) => setVariantEditForm({ ...variantEditForm, weight_kg: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">數量</label>
                        <input type="number" value={variantEditForm.qty || ""} onChange={(e) => setVariantEditForm({ ...variantEditForm, qty: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">境內運費 (CNY)</label>
                        <input type="number" step="0.1" value={variantEditForm.domestic_shipping_cny || ""} onChange={(e) => setVariantEditForm({ ...variantEditForm, domestic_shipping_cny: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveVariant} disabled={saving}
                        className="flex-1 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium active:bg-blue-700 disabled:opacity-50">
                        {saving ? "儲存中..." : "儲存"}
                      </button>
                      <button onClick={() => setEditingVariantId(null)}
                        className="flex-1 py-1.5 rounded-lg bg-slate-200 text-slate-600 text-xs font-medium active:bg-slate-300">
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="font-medium text-sm truncate">{v.variant_name}</h4>
                        <div className="flex gap-3 mt-1 text-[11px] text-slate-500 flex-wrap">
                          {v.purchase_price_cny != null && <span>進價 ¥{v.purchase_price_cny}</span>}
                          {v.selling_price_ntd != null && <span>售價 ${v.selling_price_ntd}</span>}
                          {v.qty != null && <span>x{v.qty}</span>}
                          {v.weight_kg != null && <span>{v.weight_kg}kg</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {v.unit_cost_ntd != null && (
                          <div className="text-xs text-slate-600">成本 ${v.unit_cost_ntd.toFixed(0)}</div>
                        )}
                        {v.margin_pct != null && (
                          <div className={`text-[11px] font-medium ${v.margin_pct >= 40 ? "text-emerald-600" : v.margin_pct >= 20 ? "text-amber-600" : "text-red-500"}`}>
                            毛利 {v.margin_pct.toFixed(1)}%
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-1">
                      <button onClick={() => startEditVariant(v)} className="text-[10px] text-blue-500 active:text-blue-700">編輯</button>
                      <button onClick={() => deleteVariant(v.id)} className="text-[10px] text-red-400 active:text-red-600">刪除</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Competitors Section */}
      <div className="px-4 py-3 border-t">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold">競品分析</h2>
          <button
            onClick={() => setShowAddCompetitor(!showAddCompetitor)}
            className="text-xs px-2.5 py-1 rounded-lg bg-purple-50 text-purple-600 font-medium active:bg-purple-100"
          >
            {showAddCompetitor ? "取消" : "+ 新增競品"}
          </button>
        </div>

        {showAddCompetitor && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 mb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 mb-0.5">競品名稱 *</label>
                <input type="text" value={competitorForm.competitor_name} onChange={(e) => setCompetitorForm({ ...competitorForm, competitor_name: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-300" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">售價 (NTD)</label>
                <input type="number" value={competitorForm.competitor_price || ""} onChange={(e) => setCompetitorForm({ ...competitorForm, competitor_price: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-300" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">備註</label>
                <input type="text" value={competitorForm.notes} onChange={(e) => setCompetitorForm({ ...competitorForm, notes: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-300" />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 mb-0.5">連結</label>
                <input type="text" value={competitorForm.competitor_link} onChange={(e) => setCompetitorForm({ ...competitorForm, competitor_link: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-300" placeholder="https://..." />
              </div>
            </div>
            <button onClick={addCompetitor} disabled={saving}
              className="w-full py-2 rounded-lg bg-purple-600 text-white text-sm font-medium active:bg-purple-700 disabled:opacity-50">
              {saving ? "新增中..." : "新增競品"}
            </button>
          </div>
        )}

        {competitors.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">尚未新增競品</p>
        ) : (
          <div className="space-y-2">
            {competitors.map((c) => (
              <div key={c.id} className="bg-white rounded-xl p-3 shadow-sm border border-slate-200">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-medium text-sm truncate">{c.competitor_name}</h4>
                    {c.notes && <p className="text-[11px] text-slate-400 mt-0.5">{c.notes}</p>}
                    {c.competitor_link && (
                      <a href={c.competitor_link} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] text-blue-500 underline">查看連結</a>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {c.competitor_price != null && (
                      <div className="text-base font-bold">${c.competitor_price}</div>
                    )}
                  </div>
                </div>
                <div className="flex justify-end mt-1">
                  <button onClick={() => deleteCompetitor(c.id)} className="text-[10px] text-red-400 active:text-red-600">刪除</button>
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
  return (
    <div>
      <span className="text-[11px] text-slate-400">{label}</span>
      <div className="text-sm">{value || "-"}</div>
    </div>
  );
}
