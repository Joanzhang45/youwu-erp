"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { ProductSelection } from "@/lib/database.types";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  "評估中": { label: "評估中", color: "bg-blue-100 text-blue-700" },
  "考慮中": { label: "考慮中", color: "bg-blue-100 text-blue-700" },
  "測品": { label: "測品", color: "bg-amber-100 text-amber-700" },
  "已通過": { label: "已通過", color: "bg-emerald-100 text-emerald-700" },
  "預購": { label: "預購", color: "bg-emerald-100 text-emerald-700" },
  "已下單": { label: "已下單", color: "bg-emerald-100 text-emerald-700" },
  "已放棄": { label: "已放棄", color: "bg-slate-100 text-slate-500" },
  "不進貨": { label: "不進貨", color: "bg-slate-100 text-slate-500" },
};

const CATEGORIES = [
  "全部", "收納好物", "餐廚區", "浴廁區", "床寢區", "燈具", "玄關/穿鞋區", "衣物區", "布置小物",
];

type FilterType = "all" | "evaluating" | "passed" | "abandoned";

export default function SelectionsPage() {
  const { toast } = useToast();
  const [selections, setSelections] = useState<ProductSelection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState({
    product_name: "",
    category: "",
    order_link: "",
    cny_rate: 4.6,
    shipping_method: "",
    shipping_rate_per_kg: 0,
    domestic_shipping_cny: 0,
    sales_mode: "",
    notes: "",
  });

  const fetchSelections = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error: err } = await getSupabase()
        .from("product_selections")
        .select("*")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setSelections(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSelections();
  }, [fetchSelections]);

  const isEvaluating = (s: string | null) => s === "評估中" || s === "考慮中" || s === "測品";
  const isPassed = (s: string | null) => s === "已通過" || s === "已下單" || s === "預購";
  const isAbandoned = (s: string | null) => s === "已放棄" || s === "不進貨";

  const filtered = selections
    .filter((s) => {
      const matchFilter =
        filter === "all" ||
        (filter === "evaluating" && isEvaluating(s.status)) ||
        (filter === "passed" && isPassed(s.status)) ||
        (filter === "abandoned" && isAbandoned(s.status));
      const matchSearch =
        !search ||
        s.product_name?.toLowerCase().includes(search.toLowerCase()) ||
        s.selection_number?.toLowerCase().includes(search.toLowerCase());
      return matchFilter && matchSearch;
    });

  const generateSelectionNumber = () => {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const seq = String(selections.filter((s) => s.selection_number?.includes(date)).length + 1).padStart(3, "0");
    return `SEL-${date}-${seq}`;
  };

  const createSelection = async () => {
    if (!createForm.product_name.trim()) {
      toast("請輸入產品名稱", "error");
      return;
    }
    setSaving(true);
    try {
      const { error: err } = await getSupabase()
        .from("product_selections")
        .insert({
          selection_number: generateSelectionNumber(),
          selection_date: new Date().toISOString().split("T")[0],
          product_name: createForm.product_name.trim(),
          category: createForm.category || null,
          order_link: createForm.order_link || null,
          cny_rate: createForm.cny_rate || null,
          shipping_method: createForm.shipping_method || null,
          shipping_rate_per_kg: createForm.shipping_rate_per_kg || null,
          domestic_shipping_cny: createForm.domestic_shipping_cny || null,
          sales_mode: createForm.sales_mode || null,
          notes: createForm.notes || null,
          status: "評估中",
        });
      if (err) throw err;
      toast("選品建立成功", "success");
      setShowCreate(false);
      setCreateForm({ product_name: "", category: "", order_link: "", cny_rate: 4.6, shipping_method: "", shipping_rate_per_kg: 0, domestic_shipping_cny: 0, sales_mode: "", notes: "" });
      fetchSelections();
    } catch (e) {
      toast(e instanceof Error ? e.message : "建立失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const evalCount = selections.filter((s) => isEvaluating(s.status)).length;
  const passedCount = selections.filter((s) => isPassed(s.status)).length;

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
          <h1 className="text-lg font-bold">選品管理</h1>
          <p className="text-xs text-slate-300">共 {selections.length} 筆選品紀錄</p>
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
          <h2 className="text-sm font-bold text-blue-800">新增選品</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] text-slate-500 mb-0.5">產品名稱 *</label>
              <input
                type="text"
                value={createForm.product_name}
                onChange={(e) => setCreateForm({ ...createForm, product_name: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="例：矽藻土杯墊"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">分類</label>
              <select
                value={createForm.category}
                onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="">請選擇</option>
                {CATEGORIES.filter((c) => c !== "全部").map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">銷售模式</label>
              <select
                value={createForm.sales_mode}
                onChange={(e) => setCreateForm({ ...createForm, sales_mode: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="">請選擇</option>
                <option value="一般販售">一般販售</option>
                <option value="組合販售">組合販售</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">匯率 (CNY)</label>
              <input
                type="number"
                step="0.01"
                value={createForm.cny_rate}
                onChange={(e) => setCreateForm({ ...createForm, cny_rate: Number(e.target.value) })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">集運費率 (TWD/kg)</label>
              <input
                type="number"
                step="0.1"
                value={createForm.shipping_rate_per_kg}
                onChange={(e) => setCreateForm({ ...createForm, shipping_rate_per_kg: Number(e.target.value) })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">境內運費 (CNY)</label>
              <input
                type="number"
                step="0.1"
                value={createForm.domestic_shipping_cny}
                onChange={(e) => setCreateForm({ ...createForm, domestic_shipping_cny: Number(e.target.value) })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-slate-500 mb-0.5">訂貨連結</label>
              <input
                type="text"
                value={createForm.order_link}
                onChange={(e) => setCreateForm({ ...createForm, order_link: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="https://..."
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-slate-500 mb-0.5">備註</label>
              <input
                type="text"
                value={createForm.notes}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="選填"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={createSelection}
              disabled={saving}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "建立中..." : "建立選品"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 py-2 rounded-lg bg-slate-200 text-slate-600 text-sm font-medium active:bg-slate-300"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b overflow-x-auto">
        <FilterTab label={`全部 ${selections.length}`} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterTab label={`評估中 ${evalCount}`} active={filter === "evaluating"} onClick={() => setFilter("evaluating")} color="blue" />
        <FilterTab label={`已通過 ${passedCount}`} active={filter === "passed"} onClick={() => setFilter("passed")} color="emerald" />
        <FilterTab label="已放棄" active={filter === "abandoned"} onClick={() => setFilter("abandoned")} color="red" />
      </div>

      {/* Search */}
      <div className="px-4 py-2 bg-white border-b sticky top-[52px] z-20">
        <input
          type="text"
          placeholder="搜尋產品名稱、選品編號..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 bg-slate-100 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      {/* List */}
      <div className="px-4 py-2">
        {loading ? (
          <div className="text-center py-12 text-slate-400">載入中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-2">
              {selections.length === 0 ? "尚無選品紀錄" : "沒有符合的選品"}
            </p>
            {selections.length === 0 && (
              <p className="text-xs text-slate-400">點右上角 + 建立第一筆選品</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-400 px-1">顯示 {filtered.length} 筆</p>
            {filtered.map((s) => (
              <SelectionCard key={s.id} selection={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const FILTER_STYLES: Record<string, { active: string; inactive: string }> = {
  default: { active: "bg-slate-800 text-white", inactive: "bg-slate-100 text-slate-600" },
  blue: { active: "bg-blue-500 text-white", inactive: "bg-blue-50 text-blue-700" },
  emerald: { active: "bg-emerald-500 text-white", inactive: "bg-emerald-50 text-emerald-700" },
  red: { active: "bg-red-500 text-white", inactive: "bg-red-50 text-red-700" },
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

function SelectionCard({ selection: s }: { selection: ProductSelection }) {
  const status = STATUS_LABELS[s.status || ""] || {
    label: s.status || "-",
    color: "bg-slate-100 text-slate-500",
  };

  return (
    <Link
      href={`/selections/detail?id=${s.id}`}
      className="block bg-white rounded-xl p-4 shadow-sm border border-slate-200 hover:border-slate-300 transition-all active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="font-bold text-sm truncate">{s.product_name || "未命名"}</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {s.selection_number} {s.selection_date ? `| ${s.selection_date}` : ""}
          </p>
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${status.color}`}>
          {status.label}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
        {s.category && <span>{s.category}</span>}
        {s.total_qty != null && <span>數量: {s.total_qty}</span>}
        {s.total_weight_kg != null && <span>重量: {s.total_weight_kg}kg</span>}
        {s.total_purchase_cost_ntd != null && s.total_purchase_cost_ntd > 0 && (
          <span className="font-medium text-slate-700">${s.total_purchase_cost_ntd.toLocaleString()}</span>
        )}
        {s.order_amount_cny != null && s.order_amount_cny > 0 && (
          <span>¥{s.order_amount_cny.toLocaleString()}</span>
        )}
      </div>

      {s.competitor_min_price != null && s.competitor_max_price != null && (
        <p className="text-[11px] text-slate-400 mt-1">
          競品價格: ${s.competitor_min_price} ~ ${s.competitor_max_price}
        </p>
      )}

      {s.notes && (
        <p className="text-[11px] text-slate-400 mt-1 truncate">{s.notes}</p>
      )}
    </Link>
  );
}
