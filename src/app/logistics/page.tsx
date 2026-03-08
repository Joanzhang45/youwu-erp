"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { FilterTab } from "@/components/FilterTab";
import type { DomesticLogistics } from "@/lib/database.types";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  "待寄出": { label: "待寄出", color: "bg-slate-100 text-slate-600" },
  "已寄出": { label: "已寄出", color: "bg-blue-100 text-blue-700" },
  "運送中": { label: "運送中", color: "bg-amber-100 text-amber-700" },
  "已到達": { label: "已到達", color: "bg-emerald-100 text-emerald-700" },
  "已入倉": { label: "已入倉", color: "bg-purple-100 text-purple-700" },
  "已入庫": { label: "已入庫", color: "bg-purple-100 text-purple-700" },
  "異常": { label: "異常", color: "bg-red-100 text-red-700" },
};

const STATUS_OPTIONS = ["待寄出", "已寄出", "運送中", "已到達", "已入倉", "異常"];

type FilterType = "all" | "active" | "arrived" | "abnormal";

export default function LogisticsPage() {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [records, setRecords] = useState<DomesticLogistics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<DomesticLogistics>>({});
  const [poNumbers, setPoNumbers] = useState<string[]>([]);
  const [createForm, setCreateForm] = useState({
    tracking_number: "",
    po_number: "",
    logistics_company: "",
    forwarder: "",
    waybill_number: "",
    total_weight_kg: 0,
    shipping_cost_cny: 0,
    notes: "",
  });

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error: err } = await getSupabase()
        .from("domestic_logistics")
        .select("*")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setRecords(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
    // Fetch PO numbers for datalist
    getSupabase()
      .from("purchase_orders")
      .select("po_number")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setPoNumbers(data.map((d) => d.po_number));
      });
  }, [fetchRecords]);

  const isArrived = (s: string | null) => s === "已到達" || s === "已入倉" || s === "已入庫";
  const isAbnormal = (s: string | null) => s === "異常";

  const filtered = records
    .filter((r) => {
      const matchFilter =
        filter === "all" ||
        (filter === "active" && !isArrived(r.status) && !isAbnormal(r.status)) ||
        (filter === "arrived" && isArrived(r.status)) ||
        (filter === "abnormal" && isAbnormal(r.status));
      const matchSearch =
        !search ||
        r.tracking_number?.toLowerCase().includes(search.toLowerCase()) ||
        r.po_number?.toLowerCase().includes(search.toLowerCase()) ||
        r.waybill_number?.toLowerCase().includes(search.toLowerCase());
      return matchFilter && matchSearch;
    });

  const createRecord = async () => {
    if (!createForm.tracking_number.trim()) {
      toast("請輸入貨運單號", "error");
      return;
    }
    setSaving(true);
    try {
      const { error: err } = await getSupabase()
        .from("domestic_logistics")
        .insert({
          tracking_number: createForm.tracking_number.trim(),
          po_number: createForm.po_number || null,
          logistics_company: createForm.logistics_company || null,
          forwarder: createForm.forwarder || null,
          waybill_number: createForm.waybill_number || null,
          total_weight_kg: createForm.total_weight_kg || null,
          shipping_cost_cny: createForm.shipping_cost_cny || null,
          shipping_date: new Date().toISOString().split("T")[0],
          status: "待寄出",
          notes: createForm.notes || null,
        });
      if (err) throw err;
      toast("物流紀錄建立成功", "success");
      setShowCreate(false);
      setCreateForm({ tracking_number: "", po_number: "", logistics_company: "", forwarder: "", waybill_number: "", total_weight_kg: 0, shipping_cost_cny: 0, notes: "" });
      fetchRecords();
    } catch (e) {
      toast(e instanceof Error ? e.message : "建立失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (r: DomesticLogistics) => {
    setEditingId(r.id);
    setEditForm({
      tracking_number: r.tracking_number,
      po_number: r.po_number,
      logistics_company: r.logistics_company,
      forwarder: r.forwarder,
      waybill_number: r.waybill_number,
      status: r.status,
      total_weight_kg: r.total_weight_kg,
      shipping_cost_cny: r.shipping_cost_cny,
      shipping_date: r.shipping_date,
      expected_arrival: r.expected_arrival,
      actual_arrival: r.actual_arrival,
      notes: r.notes,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const { error: err } = await getSupabase()
        .from("domestic_logistics")
        .update(editForm)
        .eq("id", editingId);
      if (err) throw err;
      toast("儲存成功", "success");
      setEditingId(null);
      fetchRecords();
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteRecord = async (id: number) => {
    const ok = await confirm({ title: "刪除物流紀錄", message: "確定要刪除此物流紀錄？", confirmText: "刪除", danger: true });
    if (!ok) return;
    try {
      const { error: err } = await getSupabase().from("domestic_logistics").delete().eq("id", id);
      if (err) throw err;
      toast("已刪除", "success");
      fetchRecords();
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除失敗", "error");
    }
  };

  const activeCount = records.filter((r) => !isArrived(r.status) && !isAbnormal(r.status)).length;
  const arrivedCount = records.filter((r) => isArrived(r.status)).length;

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
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/" className="text-xl">&larr;</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold">境內物流</h1>
          <p className="text-xs text-slate-300">共 {records.length} 筆物流紀錄</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="w-9 h-9 rounded-full bg-blue-500 text-white text-xl font-bold flex items-center justify-center hover:bg-blue-600 active:scale-95 transition-all"
        >
          {showCreate ? "\u00d7" : "+"}
        </button>
      </header>

      {showCreate && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-4 space-y-3">
          <h2 className="text-sm font-bold text-blue-800">新增物流紀錄</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">貨運單號 *</label>
              <input type="text" value={createForm.tracking_number} onChange={(e) => setCreateForm({ ...createForm, tracking_number: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">採購單號</label>
              <input type="text" list="po-list" value={createForm.po_number} onChange={(e) => setCreateForm({ ...createForm, po_number: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" placeholder="PO-..." />
              <datalist id="po-list">
                {poNumbers.map((pn) => <option key={pn} value={pn} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">物流公司</label>
              <input type="text" value={createForm.logistics_company} onChange={(e) => setCreateForm({ ...createForm, logistics_company: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">集運商</label>
              <input type="text" value={createForm.forwarder} onChange={(e) => setCreateForm({ ...createForm, forwarder: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">集運入庫單號</label>
              <input type="text" value={createForm.waybill_number} onChange={(e) => setCreateForm({ ...createForm, waybill_number: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">重量 (kg)</label>
              <input type="number" step="0.01" value={createForm.total_weight_kg || ""} onChange={(e) => setCreateForm({ ...createForm, total_weight_kg: Number(e.target.value) })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">運費 (CNY)</label>
              <input type="number" step="0.1" value={createForm.shipping_cost_cny || ""} onChange={(e) => setCreateForm({ ...createForm, shipping_cost_cny: Number(e.target.value) })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">備註</label>
              <input type="text" value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={createRecord} disabled={saving}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50">
              {saving ? "建立中..." : "建立紀錄"}
            </button>
            <button onClick={() => setShowCreate(false)}
              className="flex-1 py-2 rounded-lg bg-slate-200 text-slate-600 text-sm font-medium active:bg-slate-300">
              取消
            </button>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b overflow-x-auto">
        <FilterTab label={`全部 ${records.length}`} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterTab label={`運送中 ${activeCount}`} active={filter === "active"} onClick={() => setFilter("active")} color="blue" />
        <FilterTab label={`已到達 ${arrivedCount}`} active={filter === "arrived"} onClick={() => setFilter("arrived")} color="emerald" />
        <FilterTab label="異常" active={filter === "abnormal"} onClick={() => setFilter("abnormal")} color="red" />
      </div>

      {/* Search */}
      <div className="px-4 py-2 bg-white border-b sticky top-[52px] z-20">
        <input type="text" placeholder="搜尋單號、採購單號..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 bg-slate-100 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-300" />
      </div>

      {/* List */}
      <div className="px-4 py-2">
        {loading ? (
          <div className="text-center py-12 text-slate-400">載入中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-2">
              {records.length === 0 ? "尚無物流紀錄" : "沒有符合的紀錄"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-400 px-1">顯示 {filtered.length} 筆</p>
            {filtered.map((r) => (
              <div key={r.id}>
                <LogisticsCard
                  record={r}
                  onEdit={() => startEdit(r)}
                  onDelete={() => deleteRecord(r.id)}
                  isEditing={editingId === r.id}
                />
                {editingId === r.id && (
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

function LogisticsCard({ record: r, onEdit, onDelete, isEditing }: {
  record: DomesticLogistics; onEdit: () => void; onDelete: () => void; isEditing: boolean;
}) {
  const status = STATUS_LABELS[r.status || ""] || { label: r.status || "-", color: "bg-slate-100 text-slate-500" };

  return (
    <div
      className={`bg-white rounded-xl p-4 shadow-sm border cursor-pointer transition-all ${
        isEditing ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"
      }`}
      onClick={onEdit}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="font-bold text-sm truncate">{r.tracking_number || "無單號"}</h3>
          {r.po_number && <p className="text-[11px] text-slate-400 mt-0.5">{r.po_number}</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${status.color}`}>
            {status.label}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-[10px] text-red-400 active:text-red-600 px-1"
          >
            x
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
        {r.logistics_company && <span>{r.logistics_company}</span>}
        {r.forwarder && <span>集運: {r.forwarder}</span>}
        {r.waybill_number && <span>入庫: {r.waybill_number}</span>}
        {r.total_weight_kg != null && <span>{r.total_weight_kg}kg</span>}
        {r.shipping_cost_cny != null && r.shipping_cost_cny > 0 && <span>¥{r.shipping_cost_cny}</span>}
        {r.shipping_date && <span>{r.shipping_date}</span>}
      </div>

      {r.notes && <p className="text-[11px] text-slate-400 mt-1 truncate">{r.notes}</p>}
    </div>
  );
}

function EditPanel({ form, setForm, onSave, onCancel, saving }: {
  form: Partial<DomesticLogistics>;
  setForm: (f: Partial<DomesticLogistics>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-b-xl px-4 py-3 -mt-1 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">貨運單號</label>
          <input type="text" value={form.tracking_number || ""} onChange={(e) => setForm({ ...form, tracking_number: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">採購單號</label>
          <input type="text" value={form.po_number || ""} onChange={(e) => setForm({ ...form, po_number: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">狀態</label>
          <select value={form.status || ""} onChange={(e) => setForm({ ...form, status: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300">
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">物流公司</label>
          <input type="text" value={form.logistics_company || ""} onChange={(e) => setForm({ ...form, logistics_company: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">集運商</label>
          <input type="text" value={form.forwarder || ""} onChange={(e) => setForm({ ...form, forwarder: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">入庫單號</label>
          <input type="text" value={form.waybill_number || ""} onChange={(e) => setForm({ ...form, waybill_number: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">重量 (kg)</label>
          <input type="number" step="0.01" value={form.total_weight_kg ?? ""} onChange={(e) => setForm({ ...form, total_weight_kg: e.target.value ? Number(e.target.value) : null })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">運費 (CNY)</label>
          <input type="number" step="0.1" value={form.shipping_cost_cny ?? ""} onChange={(e) => setForm({ ...form, shipping_cost_cny: e.target.value ? Number(e.target.value) : null })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">寄出日期</label>
          <input type="date" value={form.shipping_date || ""} onChange={(e) => setForm({ ...form, shipping_date: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-0.5">到達日期</label>
          <input type="date" value={form.actual_arrival || ""} onChange={(e) => setForm({ ...form, actual_arrival: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] text-slate-500 mb-0.5">備註</label>
          <input type="text" value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving}
          className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50">
          {saving ? "儲存中..." : "儲存"}
        </button>
        <button onClick={onCancel}
          className="flex-1 py-2 rounded-lg bg-slate-200 text-slate-600 text-sm font-medium active:bg-slate-300">
          取消
        </button>
      </div>
    </div>
  );
}
