"use client";

// 新增商品的底部彈出表單（M4 第三批 /catalog）。視覺沿用 StockAdjustSheet 慣例
// （bottom sheet on 手機、置中 modal on 桌機），欄位沿用舊 /products 頁 addForm 能力，
// 一個字都不改動舊頁本身。編輯既有商品走 ProductDetail 全頁（PRD 詳情/編輯用 query param）；
// 這支只負責「新增」，範圍窄、欄位少，適合快速動作用 sheet 而非整頁。
import { useState } from "react";
import type { Product } from "@/lib/database.types";
import { CheckIcon } from "./icons";

const CATEGORIES = ["收納好物", "餐廚區", "浴廁區", "床寢區", "燈具", "玄關/穿鞋區", "衣物區", "布置小物"];

type FormState = Partial<Product>;

const INITIAL: FormState = { product_status: "測品", product_positioning: "一般款" };

export function ProductFormSheet({
  onCreate,
  onClose,
}: {
  onCreate: (form: FormState) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!form.product_name?.trim()) {
      setError("請輸入商品名稱");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onCreate(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增失敗");
      setSaving(false);
    }
  };

  const Field = ({
    label,
    field,
    type = "text",
    placeholder,
  }: {
    label: string;
    field: keyof FormState;
    type?: string;
    placeholder?: string;
  }) => (
    <div>
      <label className="block text-xs font-medium text-[#171717] mb-1">{label}</label>
      <input
        type={type}
        value={(form[field] as string | number | undefined) ?? ""}
        onChange={(e) =>
          setForm({
            ...form,
            [field]: type === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value,
          })
        }
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[#EAEAEA] p-5 app-sheet-enter">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#171717]">新增商品</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[#FAFAFA] text-[#666666] hover:bg-[#EAEAEA] transition-colors duration-150"
            aria-label="關閉"
          >
            &times;
          </button>
        </div>

        <div className="space-y-3">
          <Field label="商品名稱 *" field="product_name" placeholder="例：矽藻土杯墊" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU" field="sku" placeholder="YW-..." />
            <Field label="款式名稱" field="variant_name" placeholder="例：圓形-大理石紋" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">分類</label>
            <select
              value={form.category || ""}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150 bg-white"
            >
              <option value="">請選擇</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="售價（NTD）" field="selling_price" type="number" />
            <Field label="進貨價（CNY）" field="purchase_price_cny" type="number" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="重量（kg）" field="weight_kg" type="number" />
            <Field label="安全庫存" field="safety_stock" type="number" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">商品狀態</label>
              <select
                value={form.product_status || "測品"}
                onChange={(e) => setForm({ ...form, product_status: e.target.value })}
                className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150 bg-white"
              >
                <option value="測品">測品</option>
                <option value="常駐">常駐</option>
                <option value="停售">停售</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">產品定位</label>
              <select
                value={form.product_positioning || "一般款"}
                onChange={(e) => setForm({ ...form, product_positioning: e.target.value })}
                className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150 bg-white"
              >
                <option value="引流款">引流款</option>
                <option value="一般款">一般款</option>
                <option value="利潤款">利潤款</option>
              </select>
            </div>
          </div>
          <Field label="備註" field="notes" placeholder="選填" />
        </div>

        {error && <p className="text-[#E00] text-sm mt-3">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={saving}
          className="w-full mt-5 py-3.5 rounded-xl text-white font-semibold text-base bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? (
            "新增中..."
          ) : (
            <>
              <CheckIcon className="w-4 h-4" />
              新增商品
            </>
          )}
        </button>
      </div>
    </div>
  );
}
