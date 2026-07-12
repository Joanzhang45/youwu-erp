"use client";

// 新增／編輯營業費用的底部彈出表單（M4 第三批 /spend）。視覺沿用 StockAdjustSheet 慣例；
// 欄位與寫入邏輯沿用舊 /expenses 頁 saveExpense（category/item_name/quantity/amount/notes），
// 一個字都不改動舊頁本身。
import { useState } from "react";
import type { OperatingExpense } from "@/lib/database.types";
import { CheckIcon } from "./icons";

const CATEGORIES = ["包材", "倉儲", "人事", "物流", "軟體", "設備", "其他"];

// 本地日期字串（不經過 toISOString 的 UTC 轉換）——避開 demo-data-app.ts 已記錄過的同一顆
// 時區 bug 類型（台北 UTC+8，00:00~07:59 本地時間用 toISOString().slice(0,10) 會退回前一天）。
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function offsetLocal(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthStartLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

const QUICK_DATES = [
  { label: "今天", getValue: todayLocal },
  { label: "昨天", getValue: () => offsetLocal(1) },
  { label: "本月1日", getValue: monthStartLocal },
];

export type ExpenseFormValue = {
  expense_date: string;
  category: string;
  item_name: string;
  quantity: string;
  description: string;
  amount: string;
  notes: string;
};

function fromExpense(exp?: OperatingExpense): ExpenseFormValue {
  if (!exp) {
    return { expense_date: todayLocal(), category: "包材", item_name: "", quantity: "1", description: "", amount: "", notes: "" };
  }
  return {
    expense_date: exp.expense_date || todayLocal(),
    category: exp.category || "其他",
    item_name: exp.item_name || exp.description || "",
    quantity: String(exp.quantity || 1),
    description: exp.description || "",
    amount: String(exp.amount ?? ""),
    notes: exp.notes || "",
  };
}

export function ExpenseFormSheet({
  editing,
  onSave,
  onClose,
}: {
  editing?: OperatingExpense;
  onSave: (form: ExpenseFormValue) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ExpenseFormValue>(fromExpense(editing));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const unitPrice = Number(form.amount) && Number(form.quantity) ? (Number(form.amount) / Number(form.quantity)).toFixed(1) : "—";

  const handleSubmit = async () => {
    if (!form.amount || !form.item_name) {
      setError("請填寫品項名稱和總價");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[#EAEAEA] p-5 app-sheet-enter">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#171717]">{editing ? "編輯營業費用" : "新增營業費用"}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[#FAFAFA] text-[#666666] hover:bg-[#EAEAEA] transition-colors duration-150"
            aria-label="關閉"
          >
            &times;
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">日期</label>
            <div className="flex gap-1.5 items-center">
              <input
                type="date"
                value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                className="flex-1 px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717]"
              />
              {QUICK_DATES.map((qd) => (
                <button
                  key={qd.label}
                  onClick={() => setForm({ ...form, expense_date: qd.getValue() })}
                  className={`text-[11px] px-2 py-2 rounded-lg border flex-shrink-0 transition-colors duration-150 ${
                    form.expense_date === qd.getValue() ? "bg-[#171717] text-white border-[#171717]" : "bg-white text-[#666666] border-[#EAEAEA]"
                  }`}
                >
                  {qd.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">類別</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">品項名稱 *</label>
              <input
                type="text"
                value={form.item_name}
                onChange={(e) => setForm({ ...form, item_name: e.target.value })}
                placeholder="例：氣泡袋、標籤機"
                className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">數量</label>
              <input
                type="number"
                min="1"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">總價（TWD）*</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717]"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#666666] bg-[#FAFAFA] rounded-lg px-3 py-2 border border-[#EAEAEA]">
            <span>單價</span>
            <span className="font-semibold text-[#171717] tabular-nums">${unitPrice}</span>
            <span className="text-[11px] text-[#8F8F8F]">= 總價 ÷ 數量（自動計算）</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">備註</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="選填"
              className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717]"
            />
          </div>
        </div>

        {error && <p className="text-[#E00] text-sm mt-3">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={saving}
          className="w-full mt-5 py-3.5 rounded-xl text-white font-semibold text-base bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? (
            "儲存中..."
          ) : (
            <>
              <CheckIcon className="w-4 h-4" />
              {editing ? "更新" : "新增"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
