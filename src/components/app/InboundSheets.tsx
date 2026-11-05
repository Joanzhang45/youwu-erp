"use client";

// 進貨時間軸上的四個表單：修改採購單、新增境內物流包裹、建立集運批次、補集運總重與運費。
// 多表寫入（修改採購單、建立集運批次）走資料庫函式（migration 014），一個交易完成；單表寫入直接更新。
import { useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { ConsolidatedShipment, PurchaseOrder, PurchaseOrderItem } from "@/lib/database.types";
import { Field, Sheet, SubmitButton, errorText, inputClass, todayLocal } from "./Sheet";

const PO_ERRORS = {
  PO_LOCKED: "這張採購單已點收或已取消，不能再修改",
  BAD_RATE: "匯率要在 3 到 10 之間",
  NO_ITEMS_LEFT: "至少要留一個品項；整張不要了請用「取消採購單」",
};

export function PurchaseOrderEditSheet({
  po,
  items,
  onClose,
  onSaved,
}: {
  po: PurchaseOrder;
  items: PurchaseOrderItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [orderDate, setOrderDate] = useState(po.order_date || todayLocal());
  const [rate, setRate] = useState(String(po.cny_rate ?? ""));
  const [notes, setNotes] = useState(po.notes || "");
  const [rows, setRows] = useState(
    items.map((i) => ({ id: i.id, name: i.product_name, variant: i.variant_name, qty: String(i.qty ?? 0), price: String(i.unit_price_cny ?? 0) }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const subtotal = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const { error: err } = await getSupabase().rpc("update_purchase_order", {
        p_po_id: po.id,
        p: {
          order_date: orderDate,
          cny_rate: Number(rate),
          notes,
          items: rows.map((r) => ({ id: r.id, qty: Math.max(0, Math.round(Number(r.qty) || 0)), unit_price_cny: Number(r.price) || 0 })),
        },
      });
      if (err) throw err;
      onSaved();
    } catch (e) {
      setError(errorText(e, PO_ERRORS));
      setBusy(false);
    }
  };

  return (
    <Sheet title="修改採購單" onClose={onClose}>
      <Field label="下單日期">
        <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className={inputClass} />
      </Field>
      <Field label="人民幣匯率">
        <input type="number" inputMode="decimal" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={inputClass} />
      </Field>
      <p className="text-sm font-medium text-[#171717] mb-1.5">品項</p>
      <div className="rounded-xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] mb-1">
        {rows.map((r, idx) => (
          <div key={r.id} className="p-3">
            <p className="text-xs font-medium text-[#171717] truncate">{r.name}</p>
            {r.variant && <p className="text-[11px] text-[#8F8F8F] truncate">{r.variant}</p>}
            <div className="flex gap-2 mt-2">
              <label className="flex-1 text-[11px] text-[#8F8F8F]">
                數量
                <input
                  type="number"
                  inputMode="numeric"
                  value={r.qty}
                  onChange={(e) => setRows((p) => p.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))}
                  className={inputClass}
                />
              </label>
              <label className="flex-1 text-[11px] text-[#8F8F8F]">
                單價（人民幣）
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={r.price}
                  onChange={(e) => setRows((p) => p.map((x, i) => (i === idx ? { ...x, price: e.target.value } : x)))}
                  className={inputClass}
                />
              </label>
            </div>
            {Number(r.qty) === 0 && <p className="text-[11px] text-[#E00] mt-1">數量 0：存檔後這個品項會被刪掉</p>}
          </div>
        ))}
      </div>
      <p className="text-xs text-[#8F8F8F] mb-3 text-right tabular-nums">
        小計 ¥{subtotal.toFixed(2)} ≈ NT${Math.round(subtotal * (Number(rate) || 0)).toLocaleString()}
      </p>
      <Field label="備註">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
      </Field>
      {error && <p className="text-[#E00] text-sm mb-3">{error}</p>}
      <SubmitButton busy={busy} onClick={save}>
        儲存修改
      </SubmitButton>
    </Sheet>
  );
}

export function LogisticsCreateSheet({
  poNumber,
  defaultForwarder,
  onClose,
  onSaved,
}: {
  poNumber: string;
  defaultForwarder: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [company, setCompany] = useState("");
  const [tracking, setTracking] = useState("");
  const [shipDate, setShipDate] = useState(todayLocal());
  const [eta, setEta] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!tracking.trim()) {
      setError("請填快遞單號");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: err } = await getSupabase()
        .from("domestic_logistics")
        .insert({
          po_number: poNumber,
          tracking_number: tracking.trim(),
          logistics_company: company.trim() || null,
          forwarder: defaultForwarder,
          shipping_date: shipDate || null,
          expected_arrival: eta || null,
          status: "已寄出",
        });
      if (err) throw err;
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title="新增境內物流包裹" onClose={onClose}>
      <Field label="快遞單號">
        <input value={tracking} onChange={(e) => setTracking(e.target.value)} className={inputClass} placeholder="例：YT1234567890" />
      </Field>
      <Field label="物流公司">
        <input value={company} onChange={(e) => setCompany(e.target.value)} className={inputClass} placeholder="例：圓通、中通、順豐" />
      </Field>
      <Field label="寄出日期">
        <input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} className={inputClass} />
      </Field>
      <Field label="預計到集運倉">
        <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} className={inputClass} />
      </Field>
      {error && <p className="text-[#E00] text-sm mb-3">{error}</p>}
      <SubmitButton busy={busy} onClick={save}>
        新增包裹
      </SubmitButton>
    </Sheet>
  );
}

export function ShipmentCreateSheet({
  po,
  items,
  shippedQtyByItem,
  onClose,
  onSaved,
}: {
  po: PurchaseOrder;
  items: PurchaseOrderItem[];
  // 這張採購單各品項已經排進其他集運批次的數量（同商品累加），用來預填「還沒出的數量」
  shippedQtyByItem: Map<number, number>;
  onClose: () => void;
  onSaved: (shipmentNumber: string) => void;
}) {
  const [forwarder, setForwarder] = useState(po.forwarder || "");
  const [method, setMethod] = useState("海運");
  const [departure, setDeparture] = useState(todayLocal());
  const [eta, setEta] = useState("");
  const [weight, setWeight] = useState("");
  const [cost, setCost] = useState("");
  const [qtys, setQtys] = useState<Record<number, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, String(Math.max(0, (i.qty || 0) - (shippedQtyByItem.get(i.id) || 0)))]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const unlinked = useMemo(() => items.filter((i) => !i.product_id), [items]);

  const save = async () => {
    const chosen = items
      .filter((i) => i.product_id && (Number(qtys[i.id]) || 0) > 0)
      .map((i) => ({ po_item_id: i.id, qty: Math.round(Number(qtys[i.id])) }));
    if (chosen.length === 0) {
      setError("至少要有一個品項的數量大於 0");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data, error: err } = await getSupabase().rpc("create_consolidated_shipment", {
        p: {
          forwarder,
          shipping_method: method,
          departure_date: departure,
          expected_arrival: eta,
          total_weight_kg: weight,
          total_cost_ntd: cost,
          items: chosen,
        },
      });
      if (err) throw err;
      onSaved(String((data as { shipment_number?: string } | null)?.shipment_number || ""));
    } catch (e) {
      setError(errorText(e, { PO_CANCELLED: "這張採購單已取消", ITEM_NOT_LINKED: "有品項沒對到商品，不能排進集運" }));
      setBusy(false);
    }
  };

  return (
    <Sheet title="建立集運批次" onClose={onClose}>
      <Field label="集運商">
        <input value={forwarder} onChange={(e) => setForwarder(e.target.value)} className={inputClass} />
      </Field>
      <Field label="運送方式">
        <div className="grid grid-cols-2 gap-2">
          {["海運", "空運"].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`py-2 text-sm rounded-lg border ${method === m ? "bg-[#171717] text-white border-[#171717]" : "bg-white text-[#666666] border-[#EAEAEA]"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </Field>
      <div className="flex gap-2">
        <div className="flex-1">
          <Field label="出發日期">
            <input type="date" value={departure} onChange={(e) => setDeparture(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="預計到台">
            <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <Field label="總重（公斤）" hint="不知道可以先空著">
            <input type="number" inputMode="decimal" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="總運費（台幣）" hint="點收前要補上">
            <input type="number" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </div>
      <p className="text-sm font-medium text-[#171717] mb-1.5">這批要寄的品項</p>
      <div className="rounded-xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] mb-3">
        {items.map((i) => (
          <div key={i.id} className="p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#171717] truncate">{i.product_name}</p>
              <p className="text-[11px] text-[#8F8F8F] truncate">
                {i.variant_name ? `${i.variant_name} · ` : ""}叫貨 {i.qty}
                {!i.product_id && <span className="text-[#E00]"> · 沒對到商品</span>}
              </p>
            </div>
            <input
              type="number"
              inputMode="numeric"
              disabled={!i.product_id}
              value={qtys[i.id] ?? "0"}
              onChange={(e) => setQtys((p) => ({ ...p, [i.id]: e.target.value }))}
              className="w-20 px-2 py-2 text-sm text-center border border-[#EAEAEA] rounded-lg outline-none focus:border-[#171717] disabled:bg-[#FAFAFA]"
            />
          </div>
        ))}
      </div>
      {unlinked.length > 0 && (
        <p className="text-[11px] text-[#8F8F8F] mb-3">沒對到商品的品項不能排進集運（點收時不會進庫存），要先到商品頁對應。</p>
      )}
      {error && <p className="text-[#E00] text-sm mb-3">{error}</p>}
      <SubmitButton busy={busy} onClick={save}>
        建立集運批次
      </SubmitButton>
    </Sheet>
  );
}

export function ShipmentCostSheet({
  shipment,
  onClose,
  onSaved,
}: {
  shipment: ConsolidatedShipment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [weight, setWeight] = useState(shipment.total_weight_kg != null ? String(shipment.total_weight_kg) : "");
  const [cost, setCost] = useState(shipment.total_cost_ntd != null ? String(shipment.total_cost_ntd) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const w = Number(weight);
    const c = Number(cost);
    if (!(w > 0)) {
      setError("總重要大於 0");
      return;
    }
    if (!(c >= 0) || cost.trim() === "") {
      setError("請填總運費（沒有運費填 0）");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: err } = await getSupabase()
        .from("consolidated_shipments")
        .update({ total_weight_kg: w, total_cost_ntd: c })
        .eq("id", shipment.id)
        .not("status", "in", "(已驗收,已入庫)");
      if (err) throw err;
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title={`${shipment.shipment_number} 總重與運費`} onClose={onClose}>
      <Field label="總重（公斤）" hint="集運商帳單上的計費重量">
        <input type="number" inputMode="decimal" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} className={inputClass} />
      </Field>
      <Field label="總運費（台幣）" hint="含關稅等這批貨全部的跨境費用，會按重量分攤到每件商品成本">
        <input type="number" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} className={inputClass} />
      </Field>
      {error && <p className="text-[#E00] text-sm mb-3">{error}</p>}
      <SubmitButton busy={busy} onClick={save}>
        儲存
      </SubmitButton>
    </Sheet>
  );
}
