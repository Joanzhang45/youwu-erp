"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { ConsolidatedShipment, ConsolidatedShipmentItem } from "@/lib/database.types";

export default function ReceivingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-400">載入中...</div>}>
      <ReceivingContent />
    </Suspense>
  );
}

type ItemWithReceiving = ConsolidatedShipmentItem & {
  expected_qty: number;
  actual_qty: number;
  condition: string;
  landed_cost_per_unit: number | null;
  purchase_price_cny: number | null;
  cost_before_shipping: number | null;
  shipping_per_unit: number | null;
};

function ReceivingContent() {
  const searchParams = useSearchParams();
  const shipmentId = Number(searchParams.get("shipment_id"));
  const { toast } = useToast();

  const [shipment, setShipment] = useState<ConsolidatedShipment | null>(null);
  const [items, setItems] = useState<ItemWithReceiving[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cnyRate, setCnyRate] = useState(4.6);
  const [cardFeeRate, setCardFeeRate] = useState(1.5);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [shipRes, itemsRes] = await Promise.all([
        getSupabase().from("consolidated_shipments").select("*").eq("id", shipmentId).single(),
        getSupabase().from("consolidated_shipment_items").select("*").eq("shipment_id", shipmentId),
      ]);
      if (shipRes.error) throw shipRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setShipment(shipRes.data);

      // Try to auto-load CNY rate from related PO
      const { data: poData } = await getSupabase()
        .from("purchase_orders")
        .select("cny_rate")
        .not("cny_rate", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (poData && poData.length > 0 && poData[0].cny_rate) {
        setCnyRate(poData[0].cny_rate);
      }

      // Fetch product purchase prices for cost preview
      const productIds = (itemsRes.data || []).map((i) => i.product_id).filter(Boolean);
      const { data: prodData } = productIds.length > 0
        ? await getSupabase().from("products").select("id, purchase_price_cny, weight_kg").in("id", productIds)
        : { data: [] };
      const prodMap = new Map((prodData || []).map((p) => [p.id, p]));

      // Map items with receiving fields
      const mapped: ItemWithReceiving[] = (itemsRes.data || []).map((item) => {
        const prod = prodMap.get(item.product_id);
        return {
          ...item,
          expected_qty: item.qty || 0,
          actual_qty: item.qty || 0,
          condition: "良好",
          landed_cost_per_unit: null,
          purchase_price_cny: prod?.purchase_price_cny ?? null,
          cost_before_shipping: null,
          shipping_per_unit: null,
        };
      });
      setItems(mapped);
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Calculate landed cost for each item
  // Formula: (CNY進價 + 境內運費) × 匯率 × (1 + 海外刷卡手續費率) + (單品重量 ÷ 批次總重量 × 集運總費用)
  const calcLandedCost = useCallback(() => {
    if (!shipment) return;
    const totalShipmentCost = Number(shipment.total_cost_ntd) || 0;
    const totalWeight = Number(shipment.total_weight_kg) || 1;

    setItems((prev) =>
      prev.map((item) => {
        const purchasePriceCny = Number(item.purchase_price_cny) || 0;
        const costBeforeShipping = purchasePriceCny * cnyRate * (1 + cardFeeRate / 100);
        const itemWeight = Number(item.weight_kg) || 0;
        const shippingPerUnit = totalWeight > 0
          ? (itemWeight / totalWeight) * totalShipmentCost
          : 0;
        const landedCost = costBeforeShipping + shippingPerUnit;
        return {
          ...item,
          cost_before_shipping: costBeforeShipping,
          shipping_per_unit: shippingPerUnit,
          landed_cost_per_unit: landedCost,
        };
      })
    );
  }, [shipment, cnyRate, cardFeeRate]);

  useEffect(() => {
    if (shipment && items.length > 0) calcLandedCost();
  }, [shipment, calcLandedCost]);

  const updateItem = (idx: number, field: string, value: number | string) => {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const submitReceiving = async () => {
    if (!shipment) return;
    setSubmitting(true);
    try {
      const totalShipmentCost = Number(shipment.total_cost_ntd) || 0;
      const totalWeight = Number(shipment.total_weight_kg) || 1;

      // 1. Create receiving record
      const receivingNumber = `RV-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${String(Math.floor(Math.random() * 999) + 1).padStart(3, "0")}`;
      const { data: rvData, error: rvErr } = await getSupabase()
        .from("receiving_records")
        .insert({
          receiving_number: receivingNumber,
          shipment_number: shipment.shipment_number,
          receiving_date: new Date().toISOString().split("T")[0],
          receiver: "manual",
        })
        .select("id")
        .single();
      if (rvErr) throw rvErr;

      // 2. Create receiving record items
      const rvItems = items.map((item) => ({
        receiving_id: rvData.id,
        product_id: item.product_id,
        product_name: item.product_name,
        variant_name: item.variant_name,
        expected_qty: item.expected_qty,
        actual_qty: item.actual_qty,
        discrepancy: item.actual_qty - item.expected_qty,
        condition: item.condition,
      }));
      const { error: rvItemErr } = await getSupabase()
        .from("receiving_record_items")
        .insert(rvItems);
      if (rvItemErr) throw rvItemErr;

      // 3. For each item, update product stock and calculate landed cost
      for (const item of items) {
        if (!item.product_id || item.actual_qty <= 0) continue;

        // Get current product data for cost calculation
        const { data: product } = await getSupabase()
          .from("products")
          .select("purchase_price_cny, weight_kg, total_purchased_qty, stock_qty, unit_cost_ntd")
          .eq("id", item.product_id)
          .single();

        if (!product) continue;

        const purchasePriceCny = Number(product.purchase_price_cny) || 0;
        const itemWeight = Number(item.weight_kg) || Number(product.weight_kg) || 0;

        // Landed cost calculation per PRD:
        // (CNY進價) × 匯率 × (1 + 海外刷卡手續費率%) + (單品重量 ÷ 批次總重量 × 集運總費用)
        const costBeforeShipping = purchasePriceCny * cnyRate * (1 + cardFeeRate / 100);
        const shippingPerUnit = totalWeight > 0
          ? (itemWeight / totalWeight) * totalShipmentCost
          : 0;
        const landedCostPerUnit = costBeforeShipping + shippingPerUnit;

        // Update product
        const newPurchasedQty = (product.total_purchased_qty || 0) + item.actual_qty;
        const newStockQty = (product.stock_qty || 0) + item.actual_qty;

        await getSupabase()
          .from("products")
          .update({
            unit_cost_ntd: Math.round(landedCostPerUnit * 100) / 100,
            total_purchased_qty: newPurchasedQty,
            stock_qty: newStockQty,
            latest_po_number: shipment.shipment_number,
          })
          .eq("id", item.product_id);

        // Create stock movement
        await getSupabase()
          .from("stock_movements")
          .insert({
            product_id: item.product_id,
            movement_type: "in",
            qty: item.actual_qty,
            reference_type: "receiving",
            notes: `驗收入庫 ${receivingNumber}`,
            created_by: "receiving",
          });
      }

      // 4. Update shipment status
      await getSupabase()
        .from("consolidated_shipments")
        .update({ status: "已驗收" })
        .eq("id", shipmentId);

      toast("驗收完成！庫存與成本已更新。");
      window.location.href = "/purchase/shipments";
    } catch (e) {
      toast(e instanceof Error ? e.message : "驗收失敗", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">載入中...</div>;
  }

  if (!shipment) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-500 mb-4">找不到集運單</p>
          <Link href="/purchase/shipments" className="text-blue-500 underline">返回集運管理</Link>
        </div>
      </div>
    );
  }

  const totalShipmentCost = Number(shipment.total_cost_ntd) || 0;
  const totalWeight = Number(shipment.total_weight_kg) || 1;

  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/purchase/shipments" className="text-xl">&larr;</Link>
        <div>
          <h1 className="text-lg font-bold">驗收入庫</h1>
          <p className="text-xs text-slate-300">{shipment.shipment_number}</p>
        </div>
      </header>

      {/* Shipment Info */}
      <div className="px-4 py-3 bg-white border-b">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <span className="text-[11px] text-slate-400">總重量</span>
            <p className="font-medium">{Number(shipment.total_weight_kg).toFixed(1)} kg</p>
          </div>
          <div>
            <span className="text-[11px] text-slate-400">總運費</span>
            <p className="font-medium">${totalShipmentCost.toLocaleString()}</p>
          </div>
          <div>
            <span className="text-[11px] text-slate-400">每公斤</span>
            <p className="font-medium">${(totalShipmentCost / totalWeight).toFixed(1)}/kg</p>
          </div>
        </div>
      </div>

      {/* Cost Parameters */}
      <div className="px-4 py-3 bg-slate-50 border-b">
        <h2 className="text-xs font-bold text-slate-500 mb-2">成本參數</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-slate-400">匯率 (CNY→TWD)</label>
            <input
              type="number"
              step="0.01"
              value={cnyRate}
              onChange={(e) => setCnyRate(Number(e.target.value))}
              className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400">海外刷卡手續費率 (%)</label>
            <input
              type="number"
              step="0.1"
              value={cardFeeRate}
              onChange={(e) => setCardFeeRate(Number(e.target.value))}
              className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="px-4 py-3">
        <h2 className="text-sm font-bold text-slate-700 mb-2">驗收品項 ({items.length})</h2>
        {items.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            此集運單尚無品項，請先在集運單中加入商品
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={item.id} className="bg-white rounded-xl p-3 border border-slate-200">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="text-sm font-medium">{item.product_name}</h4>
                    {item.variant_name && (
                      <p className="text-[11px] text-slate-400">{item.variant_name}</p>
                    )}
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                    item.condition === "良好" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                  }`}>
                    {item.condition}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div>
                    <label className="block text-[10px] text-slate-400">預期數量</label>
                    <div className="text-sm font-medium">{item.expected_qty}</div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">實收數量</label>
                    <input
                      type="number"
                      value={item.actual_qty}
                      onChange={(e) => updateItem(idx, "actual_qty", Math.max(0, Number(e.target.value)))}
                      className="w-full px-2 py-1 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                      min={0}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">狀況</label>
                    <select
                      value={item.condition}
                      onChange={(e) => updateItem(idx, "condition", e.target.value)}
                      className="w-full px-2 py-1 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                    >
                      <option value="良好">良好</option>
                      <option value="瑕疵">瑕疵</option>
                      <option value="損壞">損壞</option>
                      <option value="短缺">短缺</option>
                    </select>
                  </div>
                </div>

                {item.actual_qty !== item.expected_qty && (
                  <div className="text-[11px] text-red-500 mb-1">
                    差異: {item.actual_qty - item.expected_qty > 0 ? "+" : ""}{item.actual_qty - item.expected_qty}
                  </div>
                )}

                {/* Cost Preview */}
                <div className="bg-slate-50 rounded-lg p-2 text-[11px] text-slate-500 space-y-0.5">
                  {item.purchase_price_cny != null && item.purchase_price_cny > 0 && (
                    <div className="flex justify-between">
                      <span>進價 x 匯率 x 手續費</span>
                      <span className="text-slate-600">
                        ¥{item.purchase_price_cny} x {cnyRate} x {(1 + cardFeeRate / 100).toFixed(3)} = ${item.cost_before_shipping?.toFixed(1) ?? "—"}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>集運分攤（按重量）</span>
                    <span className="text-slate-600">
                      ${item.shipping_per_unit != null ? item.shipping_per_unit.toFixed(1) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between pt-0.5 border-t border-slate-200">
                    <span className="font-medium text-slate-700">預估落地成本</span>
                    <span className="font-bold text-slate-800">
                      ${item.landed_cost_per_unit != null ? item.landed_cost_per_unit.toFixed(2) : "—"} /件
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Landed Cost Formula */}
      <div className="px-4 py-3 bg-amber-50 border-t border-amber-200">
        <h3 className="text-xs font-bold text-amber-800 mb-1">落地成本公式</h3>
        <p className="text-[11px] text-amber-700">
          (CNY進價 x {cnyRate} x {(1 + cardFeeRate / 100).toFixed(3)}) + (單品重量 / {totalWeight.toFixed(1)}kg x ${totalShipmentCost.toLocaleString()})
        </p>
      </div>

      {/* Submit */}
      {items.length > 0 && (
        <div className="px-4 py-4">
          <button
            onClick={submitReceiving}
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-base active:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? "驗收中..." : "確認驗收入庫"}
          </button>
          <p className="text-[11px] text-slate-400 text-center mt-2">
            將更新庫存數量、落地成本，並建立庫存異動紀錄
          </p>
        </div>
      )}
    </div>
  );
}
