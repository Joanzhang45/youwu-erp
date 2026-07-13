"use client";

// 到貨點收核心流程（PRD §4.2）。取代舊版 src/app/purchase/receiving/page.tsx 的介面，
// 落地成本公式與寫入順序完全沿用該檔（見 src/lib/landedCost.ts 開頭註解），舊檔本身不動。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { calcLandedCost } from "@/lib/landedCost";
import type { ConsolidatedShipment } from "@/lib/database.types";
import { CameraIcon, CheckIcon } from "./icons";

type Condition = "良好" | "異常";

type FlowItem = {
  id: number;
  product_id: number | null;
  product_name: string;
  variant_name: string | null;
  product_image: string | null;
  expected_qty: number;
  actual_qty: number;
  condition: Condition;
  notes: string;
  purchase_price_cny: number | null;
  weight_kg: number | null;
};

type Phase = "loading" | "items" | "summary" | "submitting" | "done" | "error";

type Draft = {
  shipmentId: number;
  currentIndex: number;
  items: { id: number; actual_qty: number; condition: Condition; notes: string }[];
};

const CNY_RATE_DEFAULT = 4.6;
const CARD_FEE_RATE_DEFAULT = 1.5;

function draftKey(shipmentId: number) {
  return `youwu_receive_draft_${shipmentId}`;
}

export function ReceivingFlow({ shipmentId }: { shipmentId: number }) {
  const { toast } = useToast();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [shipment, setShipment] = useState<ConsolidatedShipment | null>(null);
  const [items, setItems] = useState<FlowItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const cnyRateRef = useRef(CNY_RATE_DEFAULT);
  const cardFeeRateRef = useRef(CARD_FEE_RATE_DEFAULT);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const persistDraft = useCallback(
    (idx: number, list: FlowItem[]) => {
      const draft: Draft = {
        shipmentId,
        currentIndex: idx,
        items: list.map((i) => ({ id: i.id, actual_qty: i.actual_qty, condition: i.condition, notes: i.notes })),
      };
      try {
        localStorage.setItem(draftKey(shipmentId), JSON.stringify(draft));
      } catch {
        // localStorage 不可用（無痕模式等）不擋主流程
      }
    },
    [shipmentId]
  );

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey(shipmentId));
    } catch {
      // ignore
    }
  }, [shipmentId]);

  const fetchData = useCallback(async () => {
    setPhase("loading");
    try {
      const supabase = getSupabase();
      const [shipRes, itemsRes, poRes] = await Promise.all([
        supabase.from("consolidated_shipments").select("*").eq("id", shipmentId).single(),
        supabase.from("consolidated_shipment_items").select("*").eq("shipment_id", shipmentId),
        supabase
          .from("purchase_orders")
          .select("cny_rate")
          .not("cny_rate", "is", null)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      if (shipRes.error) throw shipRes.error;
      if (itemsRes.error) throw itemsRes.error;
      const shipData: ConsolidatedShipment = shipRes.data;
      if (poRes.data && poRes.data.length > 0 && poRes.data[0].cny_rate) {
        cnyRateRef.current = Number(poRes.data[0].cny_rate);
      }

      const productIds = (itemsRes.data || []).map((i) => i.product_id).filter(Boolean) as number[];
      const { data: prodData } = productIds.length > 0
        ? await supabase.from("products").select("id, product_image, purchase_price_cny, weight_kg").in("id", productIds)
        : { data: [] };
      const prodMap = new Map((prodData || []).map((p) => [p.id, p]));

      let mapped: FlowItem[] = (itemsRes.data || []).map((item) => {
        const prod = item.product_id ? prodMap.get(item.product_id) : undefined;
        return {
          id: item.id,
          product_id: item.product_id,
          product_name: item.product_name || "未命名商品",
          variant_name: item.variant_name,
          product_image: prod?.product_image ?? null,
          expected_qty: item.qty || 0,
          actual_qty: item.qty || 0,
          condition: "良好" as Condition,
          notes: "",
          purchase_price_cny: prod?.purchase_price_cny ?? null,
          weight_kg: item.weight_kg ?? prod?.weight_kg ?? null,
        };
      });

      // 續點：比對 localStorage 草稿（A7）
      let restoredIndex = 0;
      try {
        const raw = localStorage.getItem(draftKey(shipmentId));
        if (raw) {
          const draft: Draft = JSON.parse(raw);
          if (draft.shipmentId === shipmentId && draft.items.length === mapped.length) {
            mapped = mapped.map((item) => {
              const saved = draft.items.find((d) => d.id === item.id);
              return saved ? { ...item, actual_qty: saved.actual_qty, condition: saved.condition, notes: saved.notes } : item;
            });
            restoredIndex = Math.min(draft.currentIndex, mapped.length - 1);
          }
        }
      } catch {
        // 損壞的草稿忽略，從頭開始
      }

      setShipment(shipData);
      setItems(mapped);
      setCurrentIndex(restoredIndex);
      setPhase(mapped.length > 0 ? "items" : "summary");
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
      setPhase("error");
    }
  }, [shipmentId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const current = items[currentIndex];

  const updateCurrent = (patch: Partial<FlowItem>) => {
    setItems((prev) => {
      const next = prev.map((it, i) => (i === currentIndex ? { ...it, ...patch } : it));
      persistDraft(currentIndex, next);
      return next;
    });
  };

  const goNext = () => {
    setPhotoPreview(null);
    if (currentIndex + 1 >= items.length) {
      persistDraft(currentIndex, items);
      setPhase("summary");
    } else {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      persistDraft(nextIdx, items);
    }
  };

  const goPrev = () => {
    if (currentIndex === 0) return;
    setPhotoPreview(null);
    const prevIdx = currentIndex - 1;
    setCurrentIndex(prevIdx);
    persistDraft(prevIdx, items);
  };

  const handlePhoto = (file: File | null) => {
    if (!file) {
      setPhotoPreview(null);
      return;
    }
    // 僅本機預覽，不上傳（後端零動範圍內無 Storage bucket，見交付報告已知缺口）
    const url = URL.createObjectURL(file);
    setPhotoPreview(url);
  };

  const diffCount = useMemo(() => items.filter((i) => i.actual_qty !== i.expected_qty).length, [items]);

  const submitReceiving = async () => {
    if (!shipment) return;
    setPhase("submitting");

    let createdReceivingId: number | null = null;
    const updatedProductIds: { id: number; prev: { unit_cost_ntd: number | null; latest_po_number: string | null } }[] = [];
    const createdItemIds: number[] = [];
    const supabase = getSupabase();

    try {
      const totalShipmentCost = Number(shipment.total_cost_ntd) || 0;
      const totalWeight = Number(shipment.total_weight_kg) || 1;

      const receivingNumber = `RV-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${String(Math.floor(Math.random() * 999) + 1).padStart(3, "0")}`;
      const { data: rvData, error: rvErr } = await supabase
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
      createdReceivingId = rvData.id;

      const rvItems = items.map((item) => ({
        receiving_id: rvData.id,
        product_id: item.product_id,
        product_name: item.product_name,
        variant_name: item.variant_name,
        expected_qty: item.expected_qty,
        actual_qty: item.actual_qty,
        // discrepancy 不可寫：receiving_record_items.discrepancy 是
        // GENERATED ALWAYS AS (actual_qty - expected_qty) STORED（見
        // supabase/migrations/001_initial_schema.sql 第 255 行），帶這欄一律 400
        // code 428C9。tester production 驗收抓到；舊版 purchase/receiving/page.tsx
        // 同樣帶了這欄（該檔不在本次改動範圍，可能同樣受影響，留給 developer 另外評估）。
        condition: item.condition,
        notes: item.notes || null,
      }));
      const { data: rvItemData, error: rvItemErr } = await supabase
        .from("receiving_record_items")
        .insert(rvItems)
        .select("id");
      if (rvItemErr) throw rvItemErr;
      if (rvItemData) createdItemIds.push(...rvItemData.map((r) => r.id));

      for (const item of items) {
        if (!item.product_id || item.actual_qty <= 0) continue;
        const { data: product } = await supabase
          .from("products")
          .select("purchase_price_cny, weight_kg, unit_cost_ntd, latest_po_number")
          .eq("id", item.product_id)
          .single();
        if (!product) continue;

        updatedProductIds.push({
          id: item.product_id,
          prev: { unit_cost_ntd: product.unit_cost_ntd, latest_po_number: product.latest_po_number },
        });

        const { landedCostPerUnit } = calcLandedCost({
          purchasePriceCny: product.purchase_price_cny,
          itemWeightKg: item.weight_kg ?? product.weight_kg,
          cnyRate: cnyRateRef.current,
          cardFeeRatePct: cardFeeRateRef.current,
          totalShipmentCostNtd: totalShipmentCost,
          totalShipmentWeightKg: totalWeight,
        });

        const { error: prodErr } = await supabase
          .from("products")
          .update({
            unit_cost_ntd: Math.round(landedCostPerUnit * 100) / 100,
            latest_po_number: shipment.shipment_number,
          })
          .eq("id", item.product_id);
        if (prodErr) throw prodErr;
      }

      await supabase.from("consolidated_shipments").update({ status: "已驗收" }).eq("id", shipmentId);

      clearDraft();
      toast("點收完成！庫存與成本已更新。");
      setPhase("done");
      setTimeout(() => router.push("/today"), 900);
    } catch (e) {
      toast(e instanceof Error ? e.message : "驗收失敗，正在回滾...", "error");
      try {
        for (const { id, prev } of updatedProductIds) {
          await supabase.from("products").update(prev).eq("id", id);
        }
        if (createdItemIds.length > 0) {
          await supabase
            .from("inventory_ledger")
            .delete()
            .eq("ref_type", "receiving_record_item")
            .in("ref_no", createdItemIds.map(String));
        }
        if (createdReceivingId) {
          await supabase.from("receiving_record_items").delete().eq("receiving_id", createdReceivingId);
          await supabase.from("receiving_records").delete().eq("id", createdReceivingId);
        }
      } catch {
        toast("回滾部分失敗，請手動檢查資料", "error");
      }
      setPhase("summary");
    }
  };

  if (phase === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-[#8F8F8F] text-sm">載入中...</div>;
  }

  if (phase === "error" || !shipment) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-[#E00] mb-3 text-sm">找不到集運單</p>
          <a href="/receive" className="text-[#0070F3] text-sm underline">返回點收清單</a>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="app-success-enter text-center">
          <div className="w-16 h-16 rounded-full bg-[#0CCE6B]/10 flex items-center justify-center mx-auto mb-4">
            <CheckIcon className="w-8 h-8 text-[#0CCE6B]" />
          </div>
          <p className="text-lg font-semibold text-[#171717]">點收完成</p>
          <p className="text-sm text-[#8F8F8F] mt-1">正在返回「今天」...</p>
        </div>
      </div>
    );
  }

  if (phase === "summary" || phase === "submitting") {
    return (
      <div className="min-h-screen bg-white app-fade-up-enter">
        <header className="px-5 pt-6 pb-3 max-w-2xl mx-auto">
          <p className="text-sm text-[#8F8F8F]">{shipment.shipment_number}</p>
          <h1 className="text-xl font-semibold text-[#171717] tracking-tight mt-0.5">點收總覽</h1>
        </header>
        <main className="px-5 max-w-2xl mx-auto pb-28">
          <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden mb-5">
            {items.map((item) => {
              const diff = item.actual_qty - item.expected_qty;
              return (
                <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#171717] truncate">{item.product_name}</p>
                    {item.variant_name && <p className="text-xs text-[#8F8F8F] truncate">{item.variant_name}</p>}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={`text-sm font-semibold tabular-nums ${diff !== 0 ? "text-[#E00]" : "text-[#171717]"}`}>
                      {item.actual_qty} <span className="text-[#8F8F8F] font-normal">/ {item.expected_qty}</span>
                    </p>
                    {diff !== 0 && (
                      <p className="text-[11px] text-[#E00]">{diff > 0 ? `+${diff}` : diff}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {diffCount > 0 && (
            <p className="text-xs text-[#F5A623] mb-4 text-center">{diffCount} 項數量有差異，確認後仍可送出</p>
          )}

          <button
            onClick={submitReceiving}
            disabled={phase === "submitting"}
            className="w-full py-4 rounded-xl bg-[#171717] text-white font-semibold text-base active:scale-[0.98] transition-transform duration-150 disabled:opacity-50"
          >
            {phase === "submitting" ? "處理中..." : "完成點收"}
          </button>
          <p className="text-[11px] text-[#8F8F8F] text-center mt-2">
            將更新庫存數量、落地成本，並建立點收紀錄
          </p>
        </main>
      </div>
    );
  }

  // phase === "items"
  if (!current) return null;
  const progress = ((currentIndex + 1) / items.length) * 100;
  const isCorrect = current.actual_qty === current.expected_qty;

  return (
    // Blocker 1 修復（tester production 驗收）：手機底部 AppTabBar 是 position:fixed，
    // 這裡原本是 min-h-screen + flex-1 把「下一項」按鈕精確頂到 100vh 邊界，剛好落在
    // fixed 導覽列底下（同畫面座標，導覽列 DOM 在後、paint 在上，觸控永遠先命中導覽列）。
    // 加 pb-28 讓 flex-1 中間區塊少長一截，CTA 的實際落點退到導覽列上方，兩者不再重疊。
    <div className="min-h-screen bg-white flex flex-col pb-28">
      {/* 進度條 */}
      <div className="px-5 pt-5 max-w-2xl mx-auto w-full">
        <div className="flex items-center justify-between mb-2">
          {currentIndex > 0 ? (
            <button onClick={goPrev} className="text-xs text-[#8F8F8F] hover:text-[#171717]">‹ 上一項</button>
          ) : (
            <span />
          )}
          <span className="text-xs text-[#8F8F8F] tabular-nums">
            {currentIndex + 1} / {items.length}
          </span>
        </div>
        <div className="h-1 bg-[#EAEAEA] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#171717] transition-[width] duration-200 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div key={current.id} className="flex-1 px-5 py-6 max-w-2xl mx-auto w-full app-item-enter">
        {/* 商品圖 + 名稱（取代物流單號作為主識別，A5） */}
        <div className="flex flex-col items-center text-center mb-8">
          {current.product_image ? (
            <img
              src={current.product_image}
              alt={current.product_name}
              className="w-28 h-28 rounded-2xl object-cover bg-[#FAFAFA] border border-[#EAEAEA] mb-4"
            />
          ) : (
            <div className="w-28 h-28 rounded-2xl bg-[#FAFAFA] border border-[#EAEAEA] flex items-center justify-center text-4xl mb-4">
              📦
            </div>
          )}
          <h2 className="text-xl font-semibold text-[#171717]">{current.product_name}</h2>
          {current.variant_name && <p className="text-sm text-[#8F8F8F] mt-0.5">{current.variant_name}</p>}
        </div>

        {/* 預期數量 */}
        <div className="text-center mb-5">
          <p className="text-xs text-[#8F8F8F]">預期數量</p>
          <p className="text-2xl font-medium text-[#8F8F8F] tabular-nums">{current.expected_qty}</p>
        </div>

        {/* 實收數量大數字輸入 */}
        <div className="mb-6">
          <p className="text-xs text-[#8F8F8F] text-center mb-2">實收數量</p>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => updateCurrent({ actual_qty: Math.max(0, current.actual_qty - 1) })}
              className="w-12 h-12 rounded-full bg-[#FAFAFA] border border-[#EAEAEA] text-2xl font-medium text-[#171717] active:scale-[0.95] transition-transform duration-150"
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={current.actual_qty}
              onChange={(e) => updateCurrent({ actual_qty: Math.max(0, Number(e.target.value)) })}
              className="w-28 text-center text-5xl font-bold text-[#171717] outline-none tabular-nums border-b-2 border-[#EAEAEA] focus:border-[#171717] transition-colors duration-150"
            />
            <button
              onClick={() => updateCurrent({ actual_qty: current.actual_qty + 1 })}
              className="w-12 h-12 rounded-full bg-[#FAFAFA] border border-[#EAEAEA] text-2xl font-medium text-[#171717] active:scale-[0.95] transition-transform duration-150"
            >
              +
            </button>
          </div>
          {!isCorrect && (
            <button
              onClick={() => updateCurrent({ actual_qty: current.expected_qty })}
              className="block mx-auto mt-3 text-xs text-[#0070F3] underline"
            >
              重設為預期數量（{current.expected_qty}）
            </button>
          )}
        </div>

        {/* 狀況二選一 */}
        <div className="mb-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => updateCurrent({ condition: "良好" })}
              className={`py-3 rounded-xl text-sm font-medium border transition-colors duration-150 ${
                current.condition === "良好"
                  ? "bg-[#0CCE6B]/10 border-[#0CCE6B] text-[#0CCE6B]"
                  : "bg-white border-[#EAEAEA] text-[#8F8F8F]"
              }`}
            >
              良好
            </button>
            <button
              onClick={() => updateCurrent({ condition: "異常" })}
              className={`py-3 rounded-xl text-sm font-medium border transition-colors duration-150 ${
                current.condition === "異常"
                  ? "bg-[#E00]/10 border-[#E00] text-[#E00]"
                  : "bg-white border-[#EAEAEA] text-[#8F8F8F]"
              }`}
            >
              異常
            </button>
          </div>
        </div>

        {/* 異常展開：備註＋拍照（拍照僅本機預覽，不上傳，見已知缺口） */}
        {current.condition === "異常" && (
          <div className="mb-4 app-fade-up-enter">
            <textarea
              value={current.notes}
              onChange={(e) => updateCurrent({ notes: e.target.value })}
              placeholder="說明異常狀況（選填）"
              rows={2}
              className="w-full px-3 py-2 border border-[#EAEAEA] rounded-xl text-sm outline-none focus:border-[#171717] mb-2"
            />
            <label className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-[#EAEAEA] text-sm text-[#666666] cursor-pointer hover:border-[#171717] transition-colors duration-150">
              <CameraIcon className="w-4 h-4" />
              {photoPreview ? "重新拍照" : "拍照存證"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handlePhoto(e.target.files?.[0] || null)}
              />
            </label>
            {photoPreview && (
              <img src={photoPreview} alt="異常照片預覽" className="mt-2 w-full max-h-40 object-cover rounded-xl" />
            )}
          </div>
        )}
      </div>

      {/* 下一項 */}
      <div className="px-5 pb-6 max-w-2xl mx-auto w-full">
        <button
          onClick={goNext}
          className="w-full py-4 rounded-xl bg-[#171717] text-white font-semibold text-base active:scale-[0.98] transition-transform duration-150"
        >
          {currentIndex + 1 >= items.length ? "查看總覽" : "下一項"}
        </button>
      </div>
    </div>
  );
}
