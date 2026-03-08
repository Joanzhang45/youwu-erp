"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { FilterTab } from "@/components/FilterTab";
import type { PurchaseOrder } from "@/lib/database.types";

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

function getCurrentStatus(po: PurchaseOrder): string {
  if (po.status_cancelled) return "已取消";
  for (let i = STATUS_STEPS.length - 1; i >= 0; i--) {
    if (po[STATUS_STEPS[i].key as keyof PurchaseOrder]) return STATUS_STEPS[i].label;
  }
  return "草稿";
}

function getStatusColor(status: string): string {
  if (status === "已取消") return "bg-red-100 text-red-700";
  if (status === "已到貨") return "bg-emerald-100 text-emerald-700";
  if (status === "草稿") return "bg-slate-100 text-slate-600";
  return "bg-blue-100 text-blue-700";
}

type FilterType = "all" | "active" | "completed" | "cancelled";

export default function PurchasePage() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState({
    purchaser: "",
    forwarder: "",
    cny_rate: 4.6,
    shipping_rate_per_kg: 0,
    payment_method: "信用卡",
    notes: "",
  });

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error: err } = await getSupabase()
        .from("purchase_orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setOrders(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const filtered = orders.filter((po) => {
    const status = getCurrentStatus(po);
    if (filter === "active") return status !== "已到貨" && status !== "已取消";
    if (filter === "completed") return status === "已到貨";
    if (filter === "cancelled") return status === "已取消";
    return true;
  });

  const generatePoNumber = () => {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const seq = String(orders.filter((o) => o.po_number.includes(date)).length + 1).padStart(3, "0");
    return `PO-${date}-${seq}`;
  };

  const createOrder = async () => {
    setSaving(true);
    try {
      const po_number = generatePoNumber();
      const { error: err } = await getSupabase()
        .from("purchase_orders")
        .insert({
          po_number,
          purchaser: createForm.purchaser || null,
          forwarder: createForm.forwarder || null,
          cny_rate: createForm.cny_rate || null,
          shipping_rate_per_kg: createForm.shipping_rate_per_kg || null,
          payment_method: createForm.payment_method || null,
          notes: createForm.notes || null,
          order_date: new Date().toISOString().split("T")[0],
          status_draft: true,
        });
      if (err) throw err;
      setShowCreate(false);
      setCreateForm({ purchaser: "", forwarder: "", cny_rate: 4.6, shipping_rate_per_kg: 0, payment_method: "信用卡", notes: "" });
      fetchOrders();
    } catch (e) {
      toast(e instanceof Error ? e.message : "建立失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const activeCount = orders.filter((o) => { const s = getCurrentStatus(o); return s !== "已到貨" && s !== "已取消"; }).length;
  const completedCount = orders.filter((o) => getCurrentStatus(o) === "已到貨").length;

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
          <h1 className="text-lg font-bold">採購管理</h1>
          <p className="text-xs text-slate-300">共 {orders.length} 筆採購單</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="w-9 h-9 rounded-full bg-blue-500 text-white text-xl font-bold flex items-center justify-center hover:bg-blue-600 active:scale-95 transition-all"
        >
          {showCreate ? "\u00d7" : "+"}
        </button>
      </header>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-4 space-y-3">
          <h2 className="text-sm font-bold text-blue-800">新增採購單</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">採購人</label>
              <input
                type="text"
                value={createForm.purchaser}
                onChange={(e) => setCreateForm({ ...createForm, purchaser: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Joan"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">付款方式</label>
              <select
                value={createForm.payment_method}
                onChange={(e) => setCreateForm({ ...createForm, payment_method: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="信用卡">信用卡</option>
                <option value="支付寶">支付寶</option>
                <option value="匯款">匯款</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">集運商</label>
              <input
                type="text"
                value={createForm.forwarder}
                onChange={(e) => setCreateForm({ ...createForm, forwarder: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="集運商名稱"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">匯率 (CNY→TWD)</label>
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
              onClick={createOrder}
              disabled={saving}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "建立中..." : "建立採購單"}
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

      {/* Quick Nav */}
      <div className="px-4 py-2 bg-white border-b">
        <Link
          href="/purchase/shipments"
          className="block w-full py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium border border-amber-200 text-center active:bg-amber-100"
        >
          📦 集運管理 &amp; 驗收入庫
        </Link>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b overflow-x-auto">
        <FilterTab label={`全部 ${orders.length}`} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterTab label={`進行中 ${activeCount}`} active={filter === "active"} onClick={() => setFilter("active")} color="blue" />
        <FilterTab label={`已到貨 ${completedCount}`} active={filter === "completed"} onClick={() => setFilter("completed")} color="emerald" />
        <FilterTab label="已取消" active={filter === "cancelled"} onClick={() => setFilter("cancelled")} color="red" />
      </div>

      {/* Order List */}
      <div className="px-4 py-2">
        {loading ? (
          <div className="text-center py-12 text-slate-400">載入中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-2">
              {orders.length === 0 ? "尚無採購單" : "沒有符合的採購單"}
            </p>
            {orders.length === 0 && (
              <p className="text-xs text-slate-400">點右上角 + 建立第一張採購單</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((po) => (
              <POCard key={po.id} po={po} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function POCard({ po }: { po: PurchaseOrder }) {
  const status = getCurrentStatus(po);
  const statusColor = getStatusColor(status);

  // Calculate progress
  const progressIndex = STATUS_STEPS.findIndex((s) => s.label === status);
  const progress = status === "已取消" ? 0 : ((progressIndex + 1) / STATUS_STEPS.length) * 100;

  return (
    <Link
      href={`/purchase/detail?id=${po.id}`}
      className="block bg-white rounded-xl p-4 shadow-sm border border-slate-200 hover:border-slate-300 transition-all active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="font-bold text-sm">{po.po_number}</h3>
          {po.order_date && (
            <p className="text-[11px] text-slate-400 mt-0.5">{po.order_date}</p>
          )}
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
          {status}
        </span>
      </div>

      {/* Progress Bar */}
      {status !== "已取消" && (
        <div className="h-1.5 bg-slate-100 rounded-full mb-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${status === "已到貨" ? "bg-emerald-500" : "bg-blue-500"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Info Row */}
      <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
        {po.purchaser && <span>採購: {po.purchaser}</span>}
        {po.forwarder && <span>集運: {po.forwarder}</span>}
        {po.cny_rate && <span>匯率: {po.cny_rate}</span>}
        {po.grand_total != null && po.grand_total > 0 && (
          <span className="font-medium text-slate-700">${po.grand_total.toLocaleString()}</span>
        )}
        {po.subtotal_cny != null && po.subtotal_cny > 0 && (
          <span>¥{po.subtotal_cny.toLocaleString()}</span>
        )}
      </div>

      {po.notes && (
        <p className="text-[11px] text-slate-400 mt-1 truncate">{po.notes}</p>
      )}
    </Link>
  );
}
