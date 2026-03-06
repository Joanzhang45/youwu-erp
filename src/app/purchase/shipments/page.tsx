"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import type { ConsolidatedShipment } from "@/lib/database.types";

const STATUS_COLORS: Record<string, string> = {
  準備中: "bg-slate-100 text-slate-600",
  已出發: "bg-blue-100 text-blue-700",
  運送中: "bg-amber-100 text-amber-700",
  已到達: "bg-emerald-100 text-emerald-700",
  已驗收: "bg-purple-100 text-purple-700",
};

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<ConsolidatedShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    forwarder: "",
    shipping_method: "海運",
    total_weight_kg: "",
    shipping_cost_ntd: "",
    customs_duty: "",
    notes: "",
  });

  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await getSupabase()
        .from("consolidated_shipments")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setShipments(data || []);
    } catch (e) {
      alert(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  const generateShipmentNumber = () => {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const seq = String(shipments.filter((s) => s.shipment_number?.includes(date)).length + 1).padStart(3, "0");
    return `SH-${date}-${seq}`;
  };

  const createShipment = async () => {
    const weight = Number(form.total_weight_kg);
    const shippingCost = Number(form.shipping_cost_ntd);
    const duty = Number(form.customs_duty) || 0;
    if (!weight || !shippingCost) {
      alert("請填寫重量和運費");
      return;
    }
    setSaving(true);
    try {
      const { error } = await getSupabase()
        .from("consolidated_shipments")
        .insert({
          shipment_number: generateShipmentNumber(),
          forwarder: form.forwarder || null,
          shipping_method: form.shipping_method || null,
          status: "準備中",
          total_weight_kg: weight,
          shipping_cost_ntd: shippingCost,
          customs_duty: duty,
          total_cost_ntd: shippingCost + duty,
          notes: form.notes || null,
        });
      if (error) throw error;
      setShowCreate(false);
      setForm({ forwarder: "", shipping_method: "海運", total_weight_kg: "", shipping_cost_ntd: "", customs_duty: "", notes: "" });
      fetchShipments();
    } catch (e) {
      alert(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/purchase" className="text-xl">&larr;</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold">集運管理</h1>
          <p className="text-xs text-slate-300">共 {shipments.length} 筆集運單</p>
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
          <h2 className="text-sm font-bold text-blue-800">新增集運單</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">集運商</label>
              <input
                type="text"
                value={form.forwarder}
                onChange={(e) => setForm({ ...form, forwarder: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">運送方式</label>
              <select
                value={form.shipping_method}
                onChange={(e) => setForm({ ...form, shipping_method: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="海運">海運</option>
                <option value="空運">空運</option>
                <option value="快遞">快遞</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">總重量 (kg) *</label>
              <input
                type="number"
                step="0.01"
                value={form.total_weight_kg}
                onChange={(e) => setForm({ ...form, total_weight_kg: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">運費 (TWD) *</label>
              <input
                type="number"
                value={form.shipping_cost_ntd}
                onChange={(e) => setForm({ ...form, shipping_cost_ntd: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">關稅 (TWD)</label>
              <input
                type="number"
                value={form.customs_duty}
                onChange={(e) => setForm({ ...form, customs_duty: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">備註</label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>
          {form.total_weight_kg && form.shipping_cost_ntd && (
            <div className="text-[11px] text-slate-500 bg-white rounded p-2">
              每公斤成本: <span className="font-medium text-slate-700">
                ${(Number(form.shipping_cost_ntd) / Number(form.total_weight_kg)).toFixed(1)} TWD/kg
              </span>
              {form.customs_duty && (
                <span className="ml-3">
                  總成本: <span className="font-medium text-slate-700">
                    ${(Number(form.shipping_cost_ntd) + Number(form.customs_duty)).toLocaleString()} TWD
                  </span>
                </span>
              )}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={createShipment} disabled={saving}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50">
              {saving ? "建立中..." : "建立集運單"}
            </button>
            <button onClick={() => setShowCreate(false)}
              className="flex-1 py-2 rounded-lg bg-slate-200 text-slate-600 text-sm font-medium active:bg-slate-300">
              取消
            </button>
          </div>
        </div>
      )}

      {/* Shipment List */}
      <div className="px-4 py-2">
        {loading ? (
          <div className="text-center py-12 text-slate-400">載入中...</div>
        ) : shipments.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-2">尚無集運單</p>
            <p className="text-xs text-slate-400">點右上角 + 建立第一張集運單</p>
          </div>
        ) : (
          <div className="space-y-2">
            {shipments.map((s) => (
              <ShipmentCard key={s.id} shipment={s} onRefresh={fetchShipments} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ShipmentCard({ shipment: s, onRefresh }: { shipment: ConsolidatedShipment; onRefresh: () => void }) {
  const [expanding, setExpanding] = useState(false);
  const statusColor = STATUS_COLORS[s.status || ""] || "bg-slate-100 text-slate-600";
  const costPerKg = s.total_weight_kg && s.total_cost_ntd
    ? (Number(s.total_cost_ntd) / Number(s.total_weight_kg)).toFixed(1)
    : null;

  const nextStatus: Record<string, string> = {
    準備中: "已出發",
    已出發: "運送中",
    運送中: "已到達",
    已到達: "已驗收",
  };

  const advanceStatus = async () => {
    const next = nextStatus[s.status || ""];
    if (!next) return;
    const update: Record<string, string> = { status: next };
    if (next === "已到達") update.actual_arrival = new Date().toISOString().split("T")[0];
    const { error } = await getSupabase()
      .from("consolidated_shipments")
      .update(update)
      .eq("id", s.id);
    if (error) alert(error.message);
    else onRefresh();
  };

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="font-bold text-sm">{s.shipment_number}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            {s.forwarder && <span className="text-[11px] text-slate-400">{s.forwarder}</span>}
            {s.shipping_method && <span className="text-[11px] text-slate-400">{s.shipping_method}</span>}
          </div>
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
          {s.status}
        </span>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-slate-500">
        <span>{Number(s.total_weight_kg).toFixed(1)} kg</span>
        <span>運費 ${Number(s.shipping_cost_ntd).toLocaleString()}</span>
        {s.customs_duty && Number(s.customs_duty) > 0 && <span>關稅 ${Number(s.customs_duty).toLocaleString()}</span>}
        <span className="font-medium text-slate-700">總計 ${Number(s.total_cost_ntd).toLocaleString()}</span>
        {costPerKg && <span>${costPerKg}/kg</span>}
      </div>

      {s.notes && <p className="text-[11px] text-slate-400 mt-1">{s.notes}</p>}

      {/* Actions */}
      {nextStatus[s.status || ""] && (
        <div className="mt-2">
          <button
            onClick={() => { setExpanding(true); advanceStatus().finally(() => setExpanding(false)); }}
            disabled={expanding}
            className="w-full py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium border border-blue-200 active:bg-blue-100 disabled:opacity-50"
          >
            {expanding ? "更新中..." : `推進到「${nextStatus[s.status || ""]}」`}
          </button>
        </div>
      )}

      {s.status === "已到達" && (
        <Link
          href={`/purchase/receiving?shipment_id=${s.id}`}
          className="block mt-2 w-full py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200 text-center active:bg-emerald-100"
        >
          開始驗收入庫
        </Link>
      )}
    </div>
  );
}
