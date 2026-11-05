"use client";

// 底部彈出表單的共用外框與欄位（沿用 StockAdjustSheet 的 Geist 視覺）。
import type { ReactNode } from "react";

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[#EAEAEA] p-5 app-sheet-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#171717]">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[#FAFAFA] text-[#666666] hover:bg-[#EAEAEA] transition-colors duration-150"
            aria-label="關閉"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-medium text-[#171717] mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[#8F8F8F] mt-1">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full px-3 py-2.5 text-sm border border-[#EAEAEA] rounded-lg outline-none focus:border-[#171717] focus:ring-2 focus:ring-[#0070F3]/30";

export function SubmitButton({ busy, children, onClick }: { busy: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="w-full py-3.5 rounded-xl text-white font-semibold text-base bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-50"
    >
      {busy ? "處理中..." : children}
    </button>
  );
}

export function errorText(e: unknown, map: Record<string, string> = {}): string {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  for (const [code, text] of Object.entries(map)) if (msg.includes(code)) return text;
  return msg || "操作失敗，資料沒有寫入，可以再試一次";
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
