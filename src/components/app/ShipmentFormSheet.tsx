"use client";

// 集運批次建立／加入／編輯（2026-08-28 補）。
//
// 補的是進貨鏈中段的空洞：改版後 `consolidated_shipments`／`consolidated_shipment_items`
// 全站只有 select／update，沒有任何 insert 入口——既有 14 筆集運批次全是當初從 Ragic 匯進來的
// 歷史資料。結果是「＋叫貨」開的新採購單只會寫 purchase_orders / purchase_order_items，
// 時間軸永遠卡在「下單」節點，走不到「到貨」，/today 與 /receive 的待點收卡（兩者都只撈
// status in 準備中/已出發/運送中/已到達）也就永遠是空的。整條鏈斷在這裡。
//
// 資料層考古（2026-08-28 live DB 直查）：
// - 採購單 ↔ 集運批次是 N:M，不是 1:1。單張 PO-20250724-001 對到 4 個批次；同一個批次 13
//   同時裝了 PO-20250724-001 與 PO-20250731-001 的品項——這正是「集運」的意義（多單併一櫃）。
//   所以除了「建立新批次」還必須有「加入既有批次」，只做前者會逼使用者每張單開一個批次。
// - 關聯靠 consolidated_shipment_items.po_number 文字比對（非外鍵），沿用既有慣例寫入。
// - status 欄 schema DEFAULT 是 'pending'，但既有資料與全站 UI（SHIPMENT_NEXT／STATUS_BADGE／
//   /today／/receive 的查詢）用的都是中文詞彙，這裡一律寫中文「準備中」，不用 schema 預設值。
// - consolidated_shipment_items.weight_kg 是「單品重量」不是該列總重：ReceivingFlow 拿它當
//   calcLandedCost 的 itemWeightKg，對 shipment.total_weight_kg 算比例攤運費（見 landedCost.ts
//   公式）。所以這裡從 products.weight_kg 原值帶入，不乘數量；批次 total_weight_kg 則預設
//   自動算 Σ(單品重 × 數量) 並允許覆寫（實際過磅重通常跟估算不同）。
// - 運費多半到貨後才知道，建立時可留空，之後用 mode="edit" 補——沒補的話落地成本只有進價、
//   運費攤提是 0（ReceivingFlow 的 totalShipmentCost 取 0），點收前會在 UI 明說這件事。
//
// schema 零變更，沿用既有欄位。
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { ConsolidatedShipment } from "@/lib/database.types";
import { CheckIcon } from "./icons";

// 集運狀態全集（含歷史資料用過的終態詞彙）。mode="edit" 的狀態下拉用這份清單——
// 時間軸的單向推進按鈕只認 SHIPMENT_NEXT 的三個起始狀態，卡在「已入庫／已驗收／空白」的
// 歷史批次在那裡沒有任何按鈕可按，只能從這裡更正。
export const SHIPMENT_STATUSES = ["準備中", "已出發", "運送中", "已到達", "已驗收", "已入庫"] as const;

const FORWARDER_SUGGESTIONS = ["集運倉", "順豐", "中通", "圓通", "海快", "空運"];
const METHOD_SUGGESTIONS = ["海運", "空運", "快遞"];

export type ShipmentFormMode = "create" | "join" | "edit";

type PoItemRow = {
  id: number;
  product_id: number | null;
  product_name: string | null;
  variant_name: string | null;
  product_image: string | null;
  qty: number | null;
};

type DraftItem = {
  key: string;
  product_id: number | null;
  product_name: string;
  variant_name: string | null;
  product_image: string | null;
  poQty: number;
  shippedQty: number;
  qty: number;
  weight_kg: number | null;
};

// 本地日期字串（不走 toISOString 的 UTC 轉換——台北 UTC+8，凌晨會退回前一天，
// 同 PurchaseOrderFormSheet／ExpenseFormSheet 慣例）。
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function numOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function ShipmentFormSheet({
  mode,
  poId,
  poNumber,
  shipment,
  onClose,
  onSaved,
}: {
  mode: ShipmentFormMode;
  // create/join 需要來源採購單；edit 不需要（只改批次單頭）
  poId?: number;
  poNumber?: string;
  // join 需要可選批次清單的目前選擇；edit 需要被編輯的批次
  shipment?: ConsolidatedShipment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(mode !== "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ── 品項（create / join）
  const [items, setItems] = useState<DraftItem[]>([]);

  // ── 可加入的既有批次（join）
  const [openShipments, setOpenShipments] = useState<ConsolidatedShipment[]>([]);
  const [targetShipmentId, setTargetShipmentId] = useState<number | null>(shipment?.id ?? null);

  // ── 批次單頭
  const [forwarder, setForwarder] = useState(shipment?.forwarder || "");
  const [method, setMethod] = useState(shipment?.shipping_method || "海運");
  const [departure, setDeparture] = useState(shipment?.departure_date || todayLocal());
  const [expected, setExpected] = useState(shipment?.expected_arrival || "");
  const [shippingCost, setShippingCost] = useState(shipment?.shipping_cost_ntd != null ? String(shipment.shipping_cost_ntd) : "");
  const [customsDuty, setCustomsDuty] = useState(shipment?.customs_duty != null ? String(shipment.customs_duty) : "");
  const [totalWeight, setTotalWeight] = useState(shipment?.total_weight_kg != null ? String(shipment.total_weight_kg) : "");
  const [weightTouched, setWeightTouched] = useState(shipment?.total_weight_kg != null);
  const [status, setStatus] = useState(shipment?.status || "準備中");
  const [notes, setNotes] = useState(shipment?.notes || "");

  // 該採購單的品項，扣掉「已經被排進其他集運批次」的數量後，算出還能排的剩餘量。
  // 一張 PO 可拆多批集運（PO-20250724-001 實際拆成 4 批），所以不能假設整單一次排完。
  const loadItems = useCallback(async () => {
    if (mode === "edit" || !poId || !poNumber) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [poItemRes, shippedRes, openRes] = await Promise.all([
        supabase
          .from("purchase_order_items")
          .select("id, product_id, product_name, variant_name, product_image, qty")
          .eq("po_id", poId)
          .order("created_at"),
        supabase.from("consolidated_shipment_items").select("product_id, qty").eq("po_number", poNumber),
        supabase
          .from("consolidated_shipments")
          .select("*")
          .in("status", ["準備中", "已出發", "運送中"])
          .order("departure_date", { ascending: false }),
      ]);

      const shippedByProduct = new Map<number, number>();
      for (const row of shippedRes.data || []) {
        if (row.product_id == null) continue;
        shippedByProduct.set(row.product_id, (shippedByProduct.get(row.product_id) || 0) + (Number(row.qty) || 0));
      }

      const poItems = (poItemRes.data || []) as PoItemRow[];
      const productIds = poItems.map((i) => i.product_id).filter((v): v is number => v != null);
      const weightById = new Map<number, number | null>();
      if (productIds.length > 0) {
        const { data: prods } = await supabase.from("products").select("id, weight_kg").in("id", productIds);
        for (const p of prods || []) weightById.set(p.id, p.weight_kg);
      }

      setItems(
        poItems.map((i) => {
          const poQty = Number(i.qty) || 0;
          const shipped = i.product_id != null ? shippedByProduct.get(i.product_id) || 0 : 0;
          const remaining = Math.max(0, poQty - shipped);
          return {
            key: `poi-${i.id}`,
            product_id: i.product_id,
            product_name: i.product_name || "未命名商品",
            variant_name: i.variant_name,
            product_image: i.product_image,
            poQty,
            shippedQty: shipped,
            qty: remaining,
            weight_kg: i.product_id != null ? weightById.get(i.product_id) ?? null : null,
          };
        })
      );

      const open = (openRes.data || []) as ConsolidatedShipment[];
      setOpenShipments(open);
      if (mode === "join" && targetShipmentId == null && open.length > 0) setTargetShipmentId(open[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入品項失敗");
    } finally {
      setLoading(false);
    }
    // targetShipmentId 只作為初值判斷，不進依賴（會在使用者選批次時造成不必要的重載）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, poId, poNumber]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const selected = useMemo(() => items.filter((i) => i.qty > 0), [items]);

  // 批次總重預設 Σ(單品重 × 數量)；使用者一旦手動改過就不再覆蓋（實際過磅重≠估算重）
  const autoWeight = useMemo(
    () => selected.reduce((sum, i) => sum + (Number(i.weight_kg) || 0) * i.qty, 0),
    [selected]
  );
  useEffect(() => {
    if (mode === "edit" || weightTouched) return;
    setTotalWeight(autoWeight > 0 ? String(Math.round(autoWeight * 10000) / 10000) : "");
  }, [autoWeight, weightTouched, mode]);

  const setQty = (key: string, raw: string) => {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, qty: Math.min(n, i.poQty - i.shippedQty) } : i)));
  };

  // 集運單號 CU-YYYYMMDD-NNN，沿用既有資料格式（CU-20250730-001）。
  // shipment_number 有 UNIQUE 約束，兩人同時建單會撞號 → 撞到（23505）就重查序號重試，
  // 做法與 PurchaseOrderFormSheet 產生 PO 編號一致。
  const buildShipmentNumber = async (dateStr: string): Promise<string> => {
    const ymd = (dateStr || todayLocal()).replace(/-/g, "");
    const { data } = await getSupabase()
      .from("consolidated_shipments")
      .select("shipment_number")
      .ilike("shipment_number", `CU-${ymd}-%`)
      .order("shipment_number", { ascending: false })
      .limit(1);
    const last = data?.[0]?.shipment_number as string | undefined;
    const seq = (last ? Number(last.split("-").pop()) : 0) + 1;
    return `CU-${ymd}-${String(seq).padStart(3, "0")}`;
  };

  const itemRowsFor = (shipmentId: number) =>
    selected.map((i) => ({
      shipment_id: shipmentId,
      po_number: poNumber || null,
      product_id: i.product_id,
      product_name: i.product_name,
      variant_name: i.variant_name,
      qty: i.qty,
      // 單品重量（非該列總重）——ReceivingFlow 用它對批次總重算比例攤運費，見檔頭註解
      weight_kg: i.weight_kg,
    }));

  const headerPatch = () => {
    const ship = numOrNull(shippingCost);
    const duty = numOrNull(customsDuty);
    // total_cost_ntd 是 ReceivingFlow 攤運費的分子；運費與關稅都空就一併留 null，
    // 不要寫 0（0 與「還沒填」在點收畫面要能分辨，才提示得出「落地成本未含運費」）
    const total = ship == null && duty == null ? null : (ship || 0) + (duty || 0);
    return {
      forwarder: forwarder.trim() || null,
      shipping_method: method.trim() || null,
      departure_date: departure || null,
      expected_arrival: expected || null,
      shipping_cost_ntd: ship,
      customs_duty: duty,
      total_cost_ntd: total,
      total_weight_kg: numOrNull(totalWeight),
      notes: notes.trim() || null,
    };
  };

  const save = async () => {
    setError("");
    if (mode !== "edit" && selected.length === 0) {
      setError("至少要排一個品項進集運批次");
      return;
    }
    if (mode === "join" && targetShipmentId == null) {
      setError("請選一個要加入的集運批次");
      return;
    }
    setSaving(true);
    const supabase = getSupabase();
    let createdId: number | null = null;
    try {
      if (mode === "edit") {
        if (!shipment) throw new Error("找不到要編輯的集運批次");
        const { error: upErr } = await supabase
          .from("consolidated_shipments")
          .update({ ...headerPatch(), status })
          .eq("id", shipment.id);
        if (upErr) throw upErr;
        toast("集運資訊已更新");
      } else if (mode === "join") {
        const { error: itemErr } = await supabase
          .from("consolidated_shipment_items")
          .insert(itemRowsFor(targetShipmentId as number));
        if (itemErr) throw itemErr;
        const target = openShipments.find((s) => s.id === targetShipmentId);
        toast(`已加入 ${target?.shipment_number || "集運批次"}`);
      } else {
        for (let attempt = 0; attempt < 3 && createdId == null; attempt++) {
          const shipmentNumber = await buildShipmentNumber(departure);
          const { data, error: insErr } = await supabase
            .from("consolidated_shipments")
            .insert({ shipment_number: shipmentNumber, status: "準備中", ...headerPatch() })
            .select("id")
            .single();
          if (insErr) {
            if ((insErr as { code?: string }).code === "23505" && attempt < 2) continue;
            throw insErr;
          }
          createdId = data.id;
        }
        if (createdId == null) throw new Error("集運單號產生失敗，請重試");

        const { error: itemErr } = await supabase.from("consolidated_shipment_items").insert(itemRowsFor(createdId));
        if (itemErr) throw itemErr;
        toast("集運批次已建立");
      }
      onSaved();
    } catch (e) {
      // 批次建了但品項寫入失敗 → 刪掉空批次，不要留半截資料（同 PurchaseOrderFormSheet 回滾慣例）
      if (createdId != null) {
        await supabase.from("consolidated_shipments").delete().eq("id", createdId);
      }
      setError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const title = mode === "create" ? "建立集運批次" : mode === "join" ? "加入既有集運批次" : "編輯集運資訊";
  const inputCls =
    "w-full px-3 py-2.5 bg-[#FAFAFA] border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] focus:bg-white transition-colors duration-150";
  const labelCls = "block text-xs font-medium text-[#8F8F8F] mb-1.5";

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[#EAEAEA] p-5 app-sheet-enter">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#171717]">{title}</h2>
          <button onClick={onClose} className="text-sm text-[#8F8F8F] hover:text-[#171717] transition-colors duration-150">
            關閉
          </button>
        </div>

        {loading ? (
          <div className="text-center py-10 text-[#8F8F8F] text-sm">載入中...</div>
        ) : (
          <>
            {/* 加入既有批次：先選目標批次 */}
            {mode === "join" && (
              <div className="mb-4">
                <label className={labelCls}>要加入哪個批次</label>
                {openShipments.length === 0 ? (
                  <p className="text-xs text-[#8F8F8F] rounded-lg border border-dashed border-[#EAEAEA] p-3">
                    目前沒有還沒出發／還在路上的集運批次，請改用「建立集運批次」
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {openShipments.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setTargetShipmentId(s.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors duration-150 ${
                          targetShipmentId === s.id ? "border-[#171717] bg-[#FAFAFA]" : "border-[#EAEAEA] hover:border-[#171717]"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#171717] font-mono truncate">{s.shipment_number}</p>
                          <p className="text-[11px] text-[#8F8F8F] mt-0.5">
                            {s.status || "-"} · {s.forwarder || "未指定集運商"} · 出發 {s.departure_date || "—"}
                          </p>
                        </div>
                        {targetShipmentId === s.id && <CheckIcon className="w-4 h-4 text-[#171717] flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 品項排入（create / join） */}
            {mode !== "edit" && (
              <div className="mb-4">
                <label className={labelCls}>要排進這批的品項</label>
                {items.length === 0 ? (
                  <p className="text-xs text-[#8F8F8F] rounded-lg border border-dashed border-[#EAEAEA] p-3">
                    這張採購單還沒有品項
                  </p>
                ) : (
                  <div className="rounded-xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
                    {items.map((i) => {
                      const remaining = i.poQty - i.shippedQty;
                      return (
                        <div key={i.key} className="px-3 py-2.5 flex items-center gap-2.5">
                          {i.product_image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={i.product_image} alt="" className="w-9 h-9 rounded-lg object-cover bg-[#FAFAFA] flex-shrink-0" />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-[#FAFAFA] flex items-center justify-center flex-shrink-0 text-sm">📦</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-[#171717] truncate">{i.product_name}</p>
                            {i.variant_name && <p className="text-[11px] text-[#8F8F8F] truncate">{i.variant_name}</p>}
                            <p className="text-[11px] text-[#8F8F8F] mt-0.5 tabular-nums">
                              採購 {i.poQty}
                              {i.shippedQty > 0 && ` · 已排 ${i.shippedQty} · 可排 ${remaining}`}
                              {i.weight_kg == null && " · ⚠ 無重量"}
                            </p>
                          </div>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={remaining}
                            value={i.qty}
                            onChange={(e) => setQty(i.key, e.target.value)}
                            disabled={remaining <= 0}
                            className="w-16 flex-shrink-0 px-2 py-1.5 bg-[#FAFAFA] border border-[#EAEAEA] rounded-lg text-sm text-right tabular-nums outline-none focus:border-[#171717] focus:bg-white disabled:opacity-40"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                {items.some((i) => i.weight_kg == null) && (
                  <p className="text-[11px] text-[#F5A623] mt-1.5">
                    ⚠ 有品項在商品資料沒填重量，這些品項點收時分不到運費，落地成本會偏低
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* 批次單頭：建立時填，加入既有批次時不動別人的單頭（要改請用「編輯集運資訊」） */}
        {!loading && mode !== "join" && (
          <div className="space-y-3 mb-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>集運商</label>
                <input
                  type="text"
                  value={forwarder}
                  onChange={(e) => setForwarder(e.target.value)}
                  list="forwarder-options"
                  placeholder="例：集運倉"
                  className={inputCls}
                />
                <datalist id="forwarder-options">
                  {FORWARDER_SUGGESTIONS.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className={labelCls}>運送方式</label>
                <input
                  type="text"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  list="method-options"
                  placeholder="例：海運"
                  className={inputCls}
                />
                <datalist id="method-options">
                  {METHOD_SUGGESTIONS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>出發日</label>
                <input type="date" value={departure} onChange={(e) => setDeparture(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>預計到貨</label>
                <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={inputCls} />
              </div>
            </div>

            {/* 狀態下拉只在編輯模式出現：新建一律「準備中」，之後走時間軸的推進按鈕。
                這裡是卡在「已入庫／已驗收／空白」的歷史批次唯一的更正入口
                （SHIPMENT_NEXT 只認準備中/已出發/運送中，其他狀態沒有推進按鈕可按）。 */}
            {mode === "edit" && (
              <div>
                <label className={labelCls}>狀態</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                  {SHIPMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[#8F8F8F] mt-1">
                  「已到達」才會出現在今天頁的待點收清單
                </p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>運費 NT$</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(e.target.value)}
                  placeholder="到貨後補"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>關稅 NT$</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={customsDuty}
                  onChange={(e) => setCustomsDuty(e.target.value)}
                  placeholder="選填"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>總重 kg</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={totalWeight}
                  onChange={(e) => {
                    setWeightTouched(true);
                    setTotalWeight(e.target.value);
                  }}
                  placeholder="自動估"
                  className={inputCls}
                />
              </div>
            </div>
            <p className="text-[11px] text-[#8F8F8F]">
              運費／總重是點收時攤到每件商品成本的依據；現在不知道可以留空，到貨後回來這裡補，
              補完再點收才算得出正確的落地成本。
            </p>

            <div>
              <label className={labelCls}>備註</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="選填"
                className={inputCls}
              />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-[#E00] mb-3">{error}</p>}

        <button
          onClick={save}
          disabled={saving || loading || (mode !== "edit" && selected.length === 0) || (mode === "join" && openShipments.length === 0)}
          className="w-full py-3.5 rounded-xl text-white font-semibold text-base bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-40"
        >
          {saving
            ? "儲存中..."
            : mode === "edit"
              ? "儲存變更"
              : `${mode === "join" ? "加入批次" : "建立批次"}（${selected.length} 個品項）`}
        </button>
      </div>
    </div>
  );
}
