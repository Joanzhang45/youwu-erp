"use client";

// 盤點模式核心流程（PRD §4.3、驗收契約 A14）。結構沿用 ReceivingFlow.tsx 慣例（逐項全螢幕卡、
// 進度條、localStorage 草稿續點、總覽送出），差異在於：①依分類分批（一次盤一個分類，不強迫
// 一次走完全店 165 項）②無「良好/異常」二選一，改成即時差異標色 ③完成後採 Q7 拍板「直接入帳」
// （無需二次確認差異是否要接受）。
//
// 留檔設計（見交付報告）：
//   - stock_snapshots：每個「有輸入實際數量」的品項各寫一筆（不論有無差異），note 欄直接記
//     人話「帳上 X → 實際 Y（±diff）」或「與帳上一致」——讓 /stock?records=1 不用回頭 join
//     ledger 也能還原完整盤點故事。同一批次用同一次 insert() 呼叫，Postgres 對同一交易內
//     多筆 now() 預設值會給同一時間戳，created_at 天生就是可靠的批次鍵（見 StocktakeRecords.tsx）。
//   - inventory_ledger：只有「實際 ≠ 帳上」的品項才寫一筆 qty_delta 差異量（movement_type
//     沿用既有 "manual_adjust"，ref_type 另立 "stocktake_adjust" 以跟 /stock 手動 +/- 按鈕的
//     "manual_adjust" ref_type 區分開），ref_no 用同一個 `ST-<timestamp>` 標記整批、note 用
//     既有 StockAdjustSheet REASONS 已有的 "盤點修正"（不發明新枚舉值）。這是唯一真的會改變
//     stock_qty 的寫入（stock_qty 是 v_products_with_stock 對 ledger 的聚合，products 表本身
//     沒有這欄）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { Product } from "@/lib/database.types";
import { CheckIcon } from "./icons";

type FlowItem = {
  id: number;
  product_id: number;
  product_name: string;
  variant_name: string | null;
  product_image: string | null;
  expected_qty: number;
  actual_qty: number;
  touched: boolean;
};

type Phase = "loading" | "items" | "summary" | "submitting" | "done" | "error" | "empty";

type Draft = {
  category: string;
  currentIndex: number;
  items: { id: number; actual_qty: number; touched: boolean }[];
};

function draftKey(category: string) {
  return `youwu_stocktake_draft_${category}`;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function StocktakeFlow({ category }: { category: string }) {
  const { toast } = useToast();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<FlowItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const persistDraft = useCallback(
    (idx: number, list: FlowItem[]) => {
      const draft: Draft = {
        category,
        currentIndex: idx,
        items: list.map((i) => ({ id: i.id, actual_qty: i.actual_qty, touched: i.touched })),
      };
      try {
        localStorage.setItem(draftKey(category), JSON.stringify(draft));
      } catch {
        // localStorage 不可用不擋主流程
      }
    },
    [category]
  );

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey(category));
    } catch {
      // ignore
    }
  }, [category]);

  const fetchItems = useCallback(async () => {
    setPhase("loading");
    try {
      const supabase = getSupabase();
      let query = supabase.from("v_products_with_stock").select("*").neq("product_status", "停售").order("product_name");
      query = category === "（未分類）" ? query.is("category", null) : query.eq("category", category);
      const { data, error } = await query;
      if (error) throw error;
      let mapped: FlowItem[] = ((data as Product[]) || []).map((p) => ({
        id: p.id,
        product_id: p.id,
        product_name: p.product_name,
        variant_name: p.variant_name,
        product_image: p.product_image,
        expected_qty: p.stock_qty,
        actual_qty: p.stock_qty,
        touched: false,
      }));

      let restoredIndex = 0;
      try {
        const raw = localStorage.getItem(draftKey(category));
        if (raw) {
          const draft: Draft = JSON.parse(raw);
          if (draft.category === category && draft.items.length === mapped.length) {
            mapped = mapped.map((item) => {
              const saved = draft.items.find((d) => d.id === item.id);
              return saved ? { ...item, actual_qty: saved.actual_qty, touched: saved.touched } : item;
            });
            restoredIndex = Math.min(draft.currentIndex, mapped.length - 1);
          }
        }
      } catch {
        // 損壞的草稿忽略，從頭開始
      }

      setItems(mapped);
      setCurrentIndex(restoredIndex);
      setPhase(mapped.length > 0 ? "items" : "empty");
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
      setPhase("error");
    }
  }, [category, toast]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const current = items[currentIndex];

  const updateCurrent = (patch: Partial<FlowItem>) => {
    setItems((prev) => {
      const next = prev.map((it, i) => (i === currentIndex ? { ...it, ...patch, touched: true } : it));
      persistDraft(currentIndex, next);
      return next;
    });
  };

  const goNext = () => {
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
    const prevIdx = currentIndex - 1;
    setCurrentIndex(prevIdx);
    persistDraft(prevIdx, items);
  };

  const diffItems = useMemo(() => items.filter((i) => i.actual_qty !== i.expected_qty), [items]);

  const submitStocktake = async () => {
    setPhase("submitting");

    const supabase = getSupabase();
    let createdSnapshotIds: number[] = [];
    let createdLedgerIds: number[] = [];

    try {
      const snapshotDate = todayLocal();
      const snapshotRows = items.map((item) => {
        const diff = item.actual_qty - item.expected_qty;
        const note = diff === 0 ? "盤點：與帳上一致" : `盤點差異：帳上 ${item.expected_qty} → 實際 ${item.actual_qty}（${diff > 0 ? "+" : ""}${diff}）`;
        return { product_id: item.product_id, counted_qty: item.actual_qty, snapshot_date: snapshotDate, note };
      });
      const { data: snapData, error: snapErr } = await supabase.from("stock_snapshots").insert(snapshotRows).select("id");
      if (snapErr) throw snapErr;
      createdSnapshotIds = (snapData || []).map((r) => r.id);

      if (diffItems.length > 0) {
        const refNo = `ST-${Date.now()}`;
        const ledgerRows = diffItems.map((item) => ({
          product_id: item.product_id,
          movement_type: "manual_adjust",
          qty_delta: item.actual_qty - item.expected_qty,
          ref_type: "stocktake_adjust",
          ref_no: refNo,
          note: "盤點修正",
        }));
        const { data: ledgerData, error: ledgerErr } = await supabase.from("inventory_ledger").insert(ledgerRows).select("id");
        if (ledgerErr) throw ledgerErr;
        createdLedgerIds = (ledgerData || []).map((r) => r.id);
      }

      clearDraft();
      toast(
        diffItems.length > 0
          ? `盤點完成！${diffItems.length} 項差異已更新庫存`
          : "盤點完成！全數與帳上一致"
      );
      setPhase("done");
      setTimeout(() => router.push("/stock"), 900);
    } catch (e) {
      toast(e instanceof Error ? e.message : "盤點送出失敗，正在回滾...", "error");
      try {
        if (createdLedgerIds.length > 0) await supabase.from("inventory_ledger").delete().in("id", createdLedgerIds);
        if (createdSnapshotIds.length > 0) await supabase.from("stock_snapshots").delete().in("id", createdSnapshotIds);
      } catch {
        toast("回滾部分失敗，請手動檢查資料", "error");
      }
      setPhase("summary");
    }
  };

  if (phase === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-[#8F8F8F] text-sm">載入中...</div>;
  }

  if (phase === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-[#E00] mb-3 text-sm">載入失敗</p>
          <a href="/stock?stocktake=1" className="text-[#0070F3] text-sm underline">返回選擇分類</a>
        </div>
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm text-[#8F8F8F] mb-3">「{category}」目前沒有可盤點的商品</p>
          <a href="/stock?stocktake=1" className="text-[#0070F3] text-sm underline">返回選擇分類</a>
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
          <p className="text-lg font-semibold text-[#171717]">盤點完成</p>
          <p className="text-sm text-[#8F8F8F] mt-1">正在返回「庫存」...</p>
        </div>
      </div>
    );
  }

  if (phase === "summary" || phase === "submitting") {
    return (
      <div className="min-h-screen bg-white app-fade-up-enter">
        <header className="px-5 pt-6 pb-3 max-w-2xl mx-auto">
          <p className="text-sm text-[#8F8F8F]">{category}</p>
          <h1 className="text-xl font-semibold text-[#171717] tracking-tight mt-0.5">盤點總覽</h1>
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
                    {diff !== 0 && <p className="text-[11px] text-[#E00]">{diff > 0 ? `+${diff}` : diff}</p>}
                  </div>
                </div>
              );
            })}
          </div>

          <p className={`text-xs mb-4 text-center ${diffItems.length > 0 ? "text-[#F5A623]" : "text-[#8F8F8F]"}`}>
            {diffItems.length > 0 ? `${diffItems.length} 項數量有差異，完成後將直接更新庫存` : "全數與帳上一致"}
          </p>

          <button
            onClick={submitStocktake}
            disabled={phase === "submitting"}
            className="w-full py-4 rounded-xl bg-[#171717] text-white font-semibold text-base active:scale-[0.98] transition-transform duration-150 disabled:opacity-50"
          >
            {phase === "submitting" ? "處理中..." : "完成盤點"}
          </button>
          <p className="text-[11px] text-[#8F8F8F] text-center mt-2">將把差異直接寫入庫存，並留下本次盤點紀錄</p>
        </main>
      </div>
    );
  }

  // phase === "items"
  if (!current) return null;
  const progress = ((currentIndex + 1) / items.length) * 100;
  const diff = current.actual_qty - current.expected_qty;
  const isMatch = diff === 0;

  return (
    // pb-28：底部 AppTabBar 淨空（A6/A10 前科，同 ReceivingFlow 慣例）
    <div className="min-h-screen bg-white flex flex-col pb-28">
      <div className="px-5 pt-5 max-w-2xl mx-auto w-full">
        <div className="flex items-center justify-between mb-2">
          {currentIndex > 0 ? (
            <button onClick={goPrev} className="text-xs text-[#8F8F8F] hover:text-[#171717]">‹ 上一項</button>
          ) : (
            <span className="text-xs text-[#8F8F8F]">{category}</span>
          )}
          <span className="text-xs text-[#8F8F8F] tabular-nums">
            {currentIndex + 1} / {items.length}
          </span>
        </div>
        <div className="h-1 bg-[#EAEAEA] rounded-full overflow-hidden">
          <div className="h-full bg-[#171717] transition-[width] duration-200 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div key={current.id} className="flex-1 px-5 py-6 max-w-2xl mx-auto w-full app-item-enter">
        <div className="flex flex-col items-center text-center mb-8">
          {current.product_image ? (
            <img
              src={current.product_image}
              alt={current.product_name}
              className="w-28 h-28 rounded-2xl object-cover bg-[#FAFAFA] border border-[#EAEAEA] mb-4"
            />
          ) : (
            <div className="w-28 h-28 rounded-2xl bg-[#FAFAFA] border border-[#EAEAEA] flex items-center justify-center text-4xl mb-4">📦</div>
          )}
          <h2 className="text-xl font-semibold text-[#171717]">{current.product_name}</h2>
          {current.variant_name && <p className="text-sm text-[#8F8F8F] mt-0.5">{current.variant_name}</p>}
        </div>

        <div className="text-center mb-5">
          <p className="text-xs text-[#8F8F8F]">帳上數量</p>
          <p className="text-2xl font-medium text-[#8F8F8F] tabular-nums">{current.expected_qty}</p>
        </div>

        <div className="mb-6">
          <p className="text-xs text-[#8F8F8F] text-center mb-2">實際數量</p>
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
              className={`w-28 text-center text-5xl font-bold outline-none tabular-nums border-b-2 transition-colors duration-150 ${
                isMatch ? "text-[#171717] border-[#EAEAEA] focus:border-[#171717]" : "text-[#F5A623] border-[#F5A623]"
              }`}
            />
            <button
              onClick={() => updateCurrent({ actual_qty: current.actual_qty + 1 })}
              className="w-12 h-12 rounded-full bg-[#FAFAFA] border border-[#EAEAEA] text-2xl font-medium text-[#171717] active:scale-[0.95] transition-transform duration-150"
            >
              +
            </button>
          </div>
          {/* 差異即時標色（PRD §4.3）：一致＝灰色小字確認感；有差異＝黃字＋± 差異量，一眼可辨 */}
          <p className={`text-center text-xs mt-3 font-medium ${isMatch ? "text-[#8F8F8F]" : "text-[#F5A623]"}`}>
            {isMatch ? "與帳上一致" : `差異 ${diff > 0 ? "+" : ""}${diff}`}
          </p>
        </div>
      </div>

      <div className="px-5 pb-6 max-w-2xl mx-auto w-full">
        <button
          onClick={goNext}
          className="w-full py-4 rounded-xl bg-[#171717] text-white font-semibold text-base active:scale-[0.98] transition-transform duration-150"
        >
          {currentIndex + 1 >= items.length ? "查看總覽" : isMatch ? "帳上一致，下一項" : "確認差異，下一項"}
        </button>
      </div>
    </div>
  );
}
