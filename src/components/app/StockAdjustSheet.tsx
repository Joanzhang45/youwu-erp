"use client";

// 複製自 src/components/StockModal.tsx 並改 Vercel/Geist 視覺＋原因下拉（取代自由備註），
// 舊版 StockModal 不動、仍供舊 /inventory 頁使用。
import { useState } from "react";
import type { Product } from "@/lib/database.types";
import { CheckIcon } from "./icons";

interface Props {
  product: Product;
  type: "in" | "out";
  onConfirm: (qty: number, reason: string) => Promise<void>;
  onClose: () => void;
}

const REASONS = ["手動調整", "到貨", "破損", "盤點修正"];

export function StockAdjustSheet({ product, type, onConfirm, onClose }: Props) {
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState(REASONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isIn = type === "in";
  const maxOut = product.stock_qty;

  const handleSubmit = async () => {
    if (qty <= 0) {
      setError("數量必須大於 0");
      return;
    }
    if (!isIn && qty > maxOut) {
      setError(`庫存不足，最多可出 ${maxOut}`);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(qty, reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失敗");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-[#EAEAEA] p-5 app-sheet-enter">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#171717]">
            {isIn ? "入庫" : "出庫"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[#FAFAFA] text-[#666666] hover:bg-[#EAEAEA] transition-colors duration-150"
            aria-label="關閉"
          >
            &times;
          </button>
        </div>

        <div className="bg-[#FAFAFA] rounded-xl p-3 mb-4 border border-[#EAEAEA]">
          <p className="font-medium text-sm text-[#171717]">{product.product_name}</p>
          {product.variant_name && (
            <p className="text-xs text-[#666666]">{product.variant_name}</p>
          )}
          <p className="text-xs text-[#8F8F8F] mt-1">
            目前庫存：<span className="font-semibold text-[#171717]">{product.stock_qty.toLocaleString()}</span>
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-[#171717] mb-1.5">
            {isIn ? "入庫數量" : "出庫數量"}
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQty(Math.max(1, qty - 1))}
              className="w-11 h-11 rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] text-xl font-medium text-[#171717] active:scale-[0.97] transition-transform duration-150"
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(Math.max(0, parseInt(e.target.value) || 0))}
              className="flex-1 text-center text-3xl font-semibold py-2 border border-[#EAEAEA] rounded-lg outline-none focus:border-[#171717] focus:ring-2 focus:ring-[#0070F3]/30 tabular-nums"
              min={1}
              max={!isIn ? maxOut : undefined}
            />
            <button
              onClick={() => setQty(qty + 1)}
              className="w-11 h-11 rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] text-xl font-medium text-[#171717] active:scale-[0.97] transition-transform duration-150"
            >
              +
            </button>
          </div>
          <div className="flex gap-2 mt-2">
            {[1, 5, 10, 20, 50].map((n) => (
              <button
                key={n}
                onClick={() => setQty(n)}
                className={`flex-1 py-1.5 text-xs rounded-md border transition-colors duration-150 ${
                  qty === n
                    ? "bg-[#171717] text-white border-[#171717]"
                    : "bg-white text-[#666666] border-[#EAEAEA] hover:border-[#171717]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-[#171717] mb-1.5">原因</label>
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={`py-2 text-sm rounded-lg border transition-colors duration-150 ${
                  reason === r
                    ? "bg-[#171717] text-white border-[#171717]"
                    : "bg-white text-[#666666] border-[#EAEAEA] hover:border-[#171717]"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-[#FAFAFA] rounded-xl p-3 mb-4 text-sm border border-[#EAEAEA]">
          <div className="flex justify-between">
            <span className="text-[#666666]">操作後庫存</span>
            <span className="font-semibold text-[#171717] tabular-nums">
              {(isIn ? product.stock_qty + qty : product.stock_qty - qty).toLocaleString()}
            </span>
          </div>
        </div>

        {error && <p className="text-[#E00] text-sm mb-3">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3.5 rounded-xl text-white font-semibold text-base bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting ? (
            "處理中..."
          ) : (
            <>
              <CheckIcon className="w-4 h-4" />
              {isIn ? `確認入庫 +${qty}` : `確認出庫 −${qty}`}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
