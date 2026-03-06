"use client";

import { useState } from "react";
import type { Product } from "@/lib/database.types";

interface Props {
  product: Product;
  type: "in" | "out";
  onConfirm: (qty: number, notes: string) => Promise<void>;
  onClose: () => void;
}

export function StockModal({ product, type, onConfirm, onClose }: Props) {
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
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
      await onConfirm(qty, notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失敗");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">
            {isIn ? "入庫" : "出庫"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500"
          >
            &times;
          </button>
        </div>

        {/* Product Info */}
        <div className="bg-slate-50 rounded-lg p-3 mb-4">
          <p className="font-medium text-sm">{product.product_name}</p>
          {product.variant_name && (
            <p className="text-xs text-slate-500">{product.variant_name}</p>
          )}
          <p className="text-xs text-slate-400 mt-1">
            目前庫存: <span className="font-bold text-slate-700">{product.stock_qty}</span>
          </p>
        </div>

        {/* Quantity Input */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {isIn ? "入庫數量" : "出庫數量"}
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQty(Math.max(1, qty - 1))}
              className="w-10 h-10 rounded-lg bg-slate-100 text-xl font-bold active:bg-slate-200"
            >
              -
            </button>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(Math.max(0, parseInt(e.target.value) || 0))}
              className="flex-1 text-center text-2xl font-bold py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-300"
              min={1}
              max={!isIn ? maxOut : undefined}
            />
            <button
              onClick={() => setQty(qty + 1)}
              className="w-10 h-10 rounded-lg bg-slate-100 text-xl font-bold active:bg-slate-200"
            >
              +
            </button>
          </div>
          {/* Quick buttons */}
          <div className="flex gap-2 mt-2">
            {[1, 5, 10, 20, 50].map((n) => (
              <button
                key={n}
                onClick={() => setQty(n)}
                className={`flex-1 py-1 text-xs rounded-md border transition-colors ${
                  qty === n
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-600 border-slate-200 active:bg-slate-50"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            備註 (選填)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={isIn ? "例: PO-20260306-001 到貨" : "例: 蝦皮訂單出貨"}
            className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* Result Preview */}
        <div className="bg-slate-50 rounded-lg p-3 mb-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">操作後庫存</span>
            <span className="font-bold">
              {isIn ? product.stock_qty + qty : product.stock_qty - qty}
            </span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-red-500 text-sm mb-3">{error}</p>
        )}

        {/* Confirm Button */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={`w-full py-3 rounded-xl text-white font-bold text-base transition-colors ${
            isIn
              ? "bg-emerald-600 active:bg-emerald-700"
              : "bg-blue-600 active:bg-blue-700"
          } disabled:opacity-50`}
        >
          {submitting
            ? "處理中..."
            : isIn
            ? `確認入庫 +${qty}`
            : `確認出庫 -${qty}`}
        </button>
      </div>
    </div>
  );
}
