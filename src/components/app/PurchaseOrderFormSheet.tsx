"use client";

// 新增採購單（「＋叫貨」，改版時漏搬的建單流程，2026-07-18 補）。視覺沿用 StockAdjustSheet/
// ProductFormSheet 的 bottom sheet 慣例（手機貼底、桌機置中），但內容比既有 sheet 複雜——
// 一張單要挑多個品項＋填單頭——故用同一個 sheet 容器內切換「phase」做「一屏一步」，
// 不是額外開一頁（保持與其他新增流程視覺一致，不是新發明一套 ReceivingFlow 式全頁 wizard）。
//
// 資料層考古（2026-07-18 live DB 直查，見交付報告）：
// - purchase_orders 沒有單一好用的「狀態」欄可以一次寫——10 個 status_* boolean 才是
//   computeStageIndex()／markOrdered() 實際在讀的欄位；另外還有一個 database.types.ts
//   漏收的 status（po_status_enum，見該檔案同批註解）欄位，兩者這裡一起寫，避免產生新的
//   欄位不同步。「已下單」在 status_* 慣例是 status_draft:false + status_ordered:true
//   （沿用 PurchaseOrderTimeline.markOrdered 的 patch），在 enum 慣例是 'ordered'
//   （已用 service-role 建立＋刪除一筆測試列實測合法值）。
// - grand_total／total_payment_cny 兩欄在全部 98 筆既有資料都等於 subtotal_cny 本身
//   （CNY 原始金額，不是換算後的 NTD，即使 UI 用 NT$ 前綴顯示）——這是既有資料的系統性慣例
//   （非本次改動引入），這裡照既有慣例寫、不擅自「修正」成正確換算的 NTD，理由與已知風險見
//   交付報告，避免新單金額格式與全部舊單不一致。total_payment_ntd 才是真正換算後的 NTD 值。
// - 禁止 product_id=null 的新品項（歷史無主帳教訓）：自由輸入新品名／選品候選帶入品名，
//   兩條路徑都收斂到「快速建商品」子步驟真的寫進 products 表拿到 id，不會有無主品項。
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { Product, ProductSelection } from "@/lib/database.types";
import { CheckIcon, ChevronRightIcon, PlusIcon, SearchIcon } from "./icons";

const CNY_RATE_DEFAULT = 4.45;
const CATEGORIES = ["收納好物", "餐廚區", "浴廁區", "床寢區", "燈具", "玄關/穿鞋區", "衣物區", "布置小物"];

// 本地日期字串（不經過 toISOString 的 UTC 轉換，同 ExpenseFormSheet 慣例——
// 台北 UTC+8，00:00~07:59 本地時間用 toISOString().slice(0,10) 會退回前一天）。
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Phase = "list" | "picker" | "newproduct" | "qty" | "header";

type DraftItem = {
  key: string;
  product_id: number;
  product_name: string;
  variant_name: string | null;
  product_image: string | null;
  qty: number;
  unit_price_cny: number;
};

type PendingProduct = {
  product_id: number;
  product_name: string;
  variant_name: string | null;
  product_image: string | null;
};

export function PurchaseOrderFormSheet({
  onCreated,
  onClose,
}: {
  onCreated: (poId: number) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("list");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [pending, setPending] = useState<PendingProduct | null>(null);

  // 品項挑選（picker）
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [candidates, setCandidates] = useState<ProductSelection[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  // 快速建商品（newproduct）
  const [npName, setNpName] = useState("");
  const [npVariant, setNpVariant] = useState("");
  const [npCategory, setNpCategory] = useState("");
  const [npPrice, setNpPrice] = useState("");
  const [npSaving, setNpSaving] = useState(false);
  const [npError, setNpError] = useState("");

  // 數量與單價（qty）
  const [qty, setQty] = useState(1);
  const [unitPrice, setUnitPrice] = useState("");

  // 單頭（header）
  const [orderDate, setOrderDate] = useState(todayLocal());
  const [cnyRate, setCnyRate] = useState(String(CNY_RATE_DEFAULT));
  const [purchaser, setPurchaser] = useState("張瓊安");
  const [notes, setNotes] = useState("");
  const [poNumberPreview, setPoNumberPreview] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (phase !== "picker") return;
    let active = true;
    (async () => {
      setSearching(true);
      try {
        const supabase = getSupabase();
        let query = supabase.from("v_products_with_stock").select("*").order("product_name").limit(20);
        if (search) {
          query = query.or(`product_name.ilike.%${search}%,sku.ilike.%${search}%,variant_name.ilike.%${search}%`);
        }
        const { data, error } = await query;
        if (error) throw error;
        if (active) setResults(data || []);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setSearching(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [phase, search]);

  const loadCandidates = useCallback(async () => {
    setCandidatesLoading(true);
    try {
      const { data, error } = await getSupabase()
        .from("product_selections")
        .select("*")
        .not("status", "in", "(不進貨,已放棄)")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      setCandidates(data || []);
    } catch {
      setCandidates([]);
    } finally {
      setCandidatesLoading(false);
    }
  }, []);

  const openPicker = () => {
    setSearchInput("");
    setSearch("");
    setResults([]);
    setShowCandidates(false);
    setPhase("picker");
  };

  const pickExisting = (p: Product) => {
    setPending({
      product_id: p.id,
      product_name: p.product_name,
      variant_name: p.variant_name,
      product_image: p.product_image,
    });
    setQty(1);
    setUnitPrice(p.purchase_price_cny != null ? String(p.purchase_price_cny) : "");
    setPhase("qty");
  };

  const openNewProduct = (prefillName: string, prefillCategory?: string | null) => {
    setNpName(prefillName);
    setNpVariant("");
    setNpCategory(prefillCategory || "");
    setNpPrice("");
    setNpError("");
    setPhase("newproduct");
  };

  const pickCandidate = (c: ProductSelection) => {
    openNewProduct(c.product_name || "", c.category);
  };

  const createNewProduct = async () => {
    if (!npName.trim()) {
      setNpError("請輸入商品名稱");
      return;
    }
    if (!npCategory) {
      setNpError("請選擇分類");
      return;
    }
    const priceNum = npPrice ? Number(npPrice) : NaN;
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      setNpError("請輸入進價（CNY）");
      return;
    }
    setNpSaving(true);
    setNpError("");
    try {
      const { data, error } = await getSupabase()
        .from("products")
        .insert({
          product_name: npName.trim(),
          variant_name: npVariant.trim() || null,
          category: npCategory,
          purchase_price_cny: priceNum,
          product_status: "測品",
          product_positioning: "一般款",
        })
        .select("id, product_name, variant_name, product_image")
        .single();
      if (error) throw error;
      setPending({
        product_id: data.id,
        product_name: data.product_name,
        variant_name: data.variant_name,
        product_image: data.product_image,
      });
      setQty(1);
      setUnitPrice(String(priceNum));
      setPhase("qty");
    } catch (e) {
      setNpError(e instanceof Error ? e.message : "建立商品失敗");
    } finally {
      setNpSaving(false);
    }
  };

  const confirmQty = () => {
    if (!pending) return;
    const priceNum = Number(unitPrice);
    if (!qty || qty <= 0 || !unitPrice || Number.isNaN(priceNum) || priceNum <= 0) return;
    setItems((prev) => [
      ...prev,
      {
        key: `${pending.product_id}-${Date.now()}`,
        product_id: pending.product_id,
        product_name: pending.product_name,
        variant_name: pending.variant_name,
        product_image: pending.product_image,
        qty,
        unit_price_cny: priceNum,
      },
    ]);
    setPending(null);
    setPhase("list");
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  };

  const subtotalCny = useMemo(() => items.reduce((s, i) => s + i.qty * i.unit_price_cny, 0), [items]);

  const goHeader = async () => {
    setSubmitError("");
    setPhase("header");
    try {
      const today = orderDate.replace(/-/g, "");
      const { data } = await getSupabase()
        .from("purchase_orders")
        .select("po_number")
        .ilike("po_number", `PO-${today}-%`)
        .order("po_number", { ascending: false })
        .limit(1);
      const last = data?.[0]?.po_number as string | undefined;
      const seq = (last ? Number(last.split("-").pop()) : 0) + 1;
      setPoNumberPreview(`PO-${today}-${String(seq).padStart(3, "0")}`);
    } catch {
      setPoNumberPreview("");
    }
  };

  const submit = async () => {
    if (items.length === 0) return;
    const rate = Number(cnyRate) || CNY_RATE_DEFAULT;
    setSubmitting(true);
    setSubmitError("");
    const supabase = getSupabase();
    let createdPoId: number | null = null;
    try {
      const today = orderDate.replace(/-/g, "");
      const subtotal = Math.round(subtotalCny * 10000) / 10000;
      const totalNtd = Math.round(subtotal * rate * 100) / 100;

      // po_number 撞號重試（單人使用機率極低，仍留 3 次保險：每次重試都重新查當日最大序號）
      for (let attempt = 0; attempt < 3 && !createdPoId; attempt++) {
        const { data: existing } = await supabase
          .from("purchase_orders")
          .select("po_number")
          .ilike("po_number", `PO-${today}-%`)
          .order("po_number", { ascending: false })
          .limit(1);
        const last = existing?.[0]?.po_number as string | undefined;
        const seq = (last ? Number(last.split("-").pop()) : 0) + 1;
        const poNumber = `PO-${today}-${String(seq).padStart(3, "0")}`;

        const { data: poData, error: poErr } = await supabase
          .from("purchase_orders")
          .insert({
            po_number: poNumber,
            purchaser: purchaser.trim() || "張瓊安",
            order_date: orderDate,
            cny_rate: rate,
            notes: notes.trim() || null,
            subtotal_cny: subtotal,
            total_payment_cny: subtotal,
            total_payment_ntd: totalNtd,
            grand_total: subtotal,
            status: "ordered",
            status_draft: false,
            status_confirmed: false,
            status_ordered: true,
            status_paid: false,
            status_shipping: false,
            status_warehouse_received: false,
            status_warehouse_stored: false,
            status_return_shipping: false,
            status_received: false,
            status_cancelled: false,
            status_abnormal: 0,
          })
          .select("id")
          .single();

        if (poErr) {
          if ((poErr as { code?: string }).code === "23505" && attempt < 2) continue;
          throw poErr;
        }
        createdPoId = poData.id;
      }
      if (!createdPoId) throw new Error("採購單編號產生失敗，請重試");

      const itemRows = items.map((i) => ({
        po_id: createdPoId,
        product_id: i.product_id,
        product_name: i.product_name,
        variant_name: i.variant_name,
        product_image: i.product_image,
        qty: i.qty,
        unit_price_cny: i.unit_price_cny,
        subtotal_cny: Math.round(i.qty * i.unit_price_cny * 10000) / 10000,
      }));
      const { error: itemErr } = await supabase.from("purchase_order_items").insert(itemRows);
      if (itemErr) throw itemErr;

      onCreated(createdPoId);
    } catch (e) {
      if (createdPoId) {
        await supabase.from("purchase_orders").delete().eq("id", createdPoId);
      }
      setSubmitError(e instanceof Error ? e.message : "建立失敗，請重試");
    } finally {
      setSubmitting(false);
    }
  };

  const CloseButton = () => (
    <button
      onClick={onClose}
      className="w-8 h-8 flex items-center justify-center rounded-full bg-[#FAFAFA] text-[#666666] hover:bg-[#EAEAEA] transition-colors duration-150"
      aria-label="關閉"
    >
      &times;
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[#EAEAEA] p-5 app-sheet-enter">
        {phase === "list" && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#171717]">新增採購單</h2>
              <CloseButton />
            </div>

            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#EAEAEA] p-6 text-center mb-4">
                <p className="text-sm text-[#8F8F8F]">還沒有加入任何品項</p>
              </div>
            ) : (
              <div className="rounded-xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden mb-4">
                {items.map((i) => (
                  <div key={i.key} className="px-3.5 py-3 flex items-center gap-2.5">
                    {i.product_image ? (
                      <img src={i.product_image} alt="" className="w-10 h-10 rounded-lg object-cover bg-[#FAFAFA] flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-[#FAFAFA] flex items-center justify-center flex-shrink-0 text-base">📦</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#171717] truncate">{i.product_name}</p>
                      {i.variant_name && <p className="text-xs text-[#8F8F8F] truncate">{i.variant_name}</p>}
                      <p className="text-xs text-[#8F8F8F] mt-0.5 tabular-nums">
                        x{i.qty} · ¥{i.unit_price_cny.toFixed(2)} = ¥{(i.qty * i.unit_price_cny).toFixed(2)}
                      </p>
                    </div>
                    <button onClick={() => removeItem(i.key)} className="text-xs text-[#E00] flex-shrink-0">
                      移除
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={openPicker}
              className="w-full py-3 rounded-xl border border-dashed border-[#EAEAEA] text-sm text-[#171717] font-medium flex items-center justify-center gap-1.5 mb-4 hover:border-[#171717] transition-colors duration-150"
            >
              <PlusIcon className="w-4 h-4" />
              新增品項
            </button>

            {items.length > 0 && (
              <div className="bg-[#FAFAFA] rounded-xl p-3 mb-4 border border-[#EAEAEA] flex items-center justify-between text-sm">
                <span className="text-[#666666]">品項小計</span>
                <span className="font-semibold text-[#171717] tabular-nums">¥{subtotalCny.toFixed(2)}</span>
              </div>
            )}

            <button
              onClick={goHeader}
              disabled={items.length === 0}
              className="w-full py-3.5 rounded-xl text-white font-semibold text-base bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-40"
            >
              下一步：填寫訂單資訊
            </button>
          </>
        )}

        {phase === "picker" && (
          <>
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setPhase("list")} className="text-sm text-[#0070F3] hover:underline">
                ‹ 返回
              </button>
              <h2 className="text-base font-semibold text-[#171717]">加入品項</h2>
              <CloseButton />
            </div>

            <div className="relative mb-3">
              <SearchIcon className="w-4 h-4 text-[#8F8F8F] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="搜尋既有商品名稱、SKU、款式..."
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 bg-[#FAFAFA] border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] focus:bg-white transition-colors duration-150"
              />
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1 mb-3">
              {searching ? (
                <p className="text-center text-xs text-[#8F8F8F] py-4">搜尋中...</p>
              ) : results.length === 0 ? (
                <p className="text-center text-xs text-[#8F8F8F] py-4">
                  {search ? `沒有符合「${search}」的商品` : "輸入關鍵字搜尋既有商品"}
                </p>
              ) : (
                results.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pickExisting(p)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[#FAFAFA] transition-colors duration-150 text-left"
                  >
                    {p.product_image ? (
                      <img src={p.product_image} alt="" className="w-9 h-9 rounded-lg object-cover bg-[#FAFAFA] flex-shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-[#FAFAFA] flex items-center justify-center flex-shrink-0 text-sm">📦</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#171717] truncate">{p.product_name}</p>
                      {p.variant_name && <p className="text-[11px] text-[#8F8F8F] truncate">{p.variant_name}</p>}
                    </div>
                    {p.purchase_price_cny != null && (
                      <span className="text-[11px] text-[#8F8F8F] flex-shrink-0 tabular-nums">¥{p.purchase_price_cny}</span>
                    )}
                  </button>
                ))
              )}
            </div>

            <button
              onClick={() => openNewProduct(searchInput)}
              className="w-full py-2.5 rounded-lg border border-[#EAEAEA] text-xs text-[#171717] font-medium mb-2 hover:border-[#171717] transition-colors duration-150"
            >
              找不到？{searchInput.trim() ? `直接新增商品「${searchInput.trim()}」` : "手動新增商品"}
            </button>

            <button
              onClick={() => {
                const next = !showCandidates;
                setShowCandidates(next);
                if (next && candidates.length === 0) loadCandidates();
              }}
              className="w-full flex items-center justify-between py-2 text-xs text-[#8F8F8F]"
            >
              <span>從選品候選帶入品名</span>
              <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-150 ${showCandidates ? "rotate-90" : ""}`} />
            </button>
            {showCandidates && (
              <div className="max-h-40 overflow-y-auto space-y-1 mt-1">
                {candidatesLoading ? (
                  <p className="text-center text-xs text-[#8F8F8F] py-3">載入中...</p>
                ) : candidates.length === 0 ? (
                  <p className="text-center text-xs text-[#8F8F8F] py-3">沒有可用的選品候選</p>
                ) : (
                  candidates.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => pickCandidate(c)}
                      className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[#FAFAFA] transition-colors duration-150 text-xs"
                    >
                      <span className="font-medium text-[#171717]">{c.product_name || "未命名"}</span>
                      {c.category && <span className="text-[#8F8F8F] ml-1.5">{c.category}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}

        {phase === "newproduct" && (
          <>
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setPhase("picker")} className="text-sm text-[#0070F3] hover:underline">
                ‹ 返回
              </button>
              <h2 className="text-base font-semibold text-[#171717]">快速建立商品</h2>
              <CloseButton />
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1">商品名稱 *</label>
                <input
                  type="text"
                  value={npName}
                  onChange={(e) => setNpName(e.target.value)}
                  placeholder="例：矽藻土杯墊"
                  className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1">款式名稱</label>
                <input
                  type="text"
                  value={npVariant}
                  onChange={(e) => setNpVariant(e.target.value)}
                  placeholder="選填"
                  className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1">分類 *</label>
                <select
                  value={npCategory}
                  onChange={(e) => setNpCategory(e.target.value)}
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
              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1">進價（CNY）*</label>
                <input
                  type="number"
                  value={npPrice}
                  onChange={(e) => setNpPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
                />
              </div>
              <p className="text-[11px] text-[#8F8F8F]">商品狀態預設「測品」，之後可到「商品」頁補齊其他資料</p>
            </div>

            {npError && <p className="text-[#E00] text-sm mt-3">{npError}</p>}

            <button
              onClick={createNewProduct}
              disabled={npSaving}
              className="w-full mt-5 py-3.5 rounded-xl text-white font-semibold text-base bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-50"
            >
              {npSaving ? "建立中..." : "建立並加入品項"}
            </button>
          </>
        )}

        {phase === "qty" && pending && (
          <>
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setPhase("picker")} className="text-sm text-[#0070F3] hover:underline">
                ‹ 返回
              </button>
              <h2 className="text-base font-semibold text-[#171717]">數量與單價</h2>
              <CloseButton />
            </div>

            <div className="bg-[#FAFAFA] rounded-xl p-3 mb-4 border border-[#EAEAEA] flex items-center gap-2.5">
              {pending.product_image ? (
                <img src={pending.product_image} alt="" className="w-11 h-11 rounded-lg object-cover bg-white flex-shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-lg bg-white flex items-center justify-center flex-shrink-0 text-lg">📦</div>
              )}
              <div className="min-w-0">
                <p className="font-medium text-sm text-[#171717] truncate">{pending.product_name}</p>
                {pending.variant_name && <p className="text-xs text-[#666666]">{pending.variant_name}</p>}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-[#171717] mb-1.5">數量</label>
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
                  onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="flex-1 text-center text-3xl font-semibold py-2 border border-[#EAEAEA] rounded-lg outline-none focus:border-[#171717] focus:ring-2 focus:ring-[#0070F3]/30 tabular-nums"
                  min={1}
                />
                <button
                  onClick={() => setQty(qty + 1)}
                  className="w-11 h-11 rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] text-xl font-medium text-[#171717] active:scale-[0.97] transition-transform duration-150"
                >
                  +
                </button>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-[#171717] mb-1.5">單價（CNY）</label>
              <input
                type="number"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2.5 border border-[#EAEAEA] rounded-lg text-base outline-none focus:border-[#171717] transition-colors duration-150 tabular-nums"
              />
            </div>

            <div className="bg-[#FAFAFA] rounded-xl p-3 mb-4 text-sm border border-[#EAEAEA] flex justify-between">
              <span className="text-[#666666]">小計</span>
              <span className="font-semibold text-[#171717] tabular-nums">¥{((Number(unitPrice) || 0) * qty).toFixed(2)}</span>
            </div>

            <button
              onClick={confirmQty}
              disabled={!unitPrice || Number(unitPrice) <= 0}
              className="w-full py-3.5 rounded-xl text-white font-semibold text-base bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <CheckIcon className="w-4 h-4" />
              加入品項清單
            </button>
          </>
        )}

        {phase === "header" && (
          <>
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setPhase("list")} className="text-sm text-[#0070F3] hover:underline">
                ‹ 返回
              </button>
              <h2 className="text-base font-semibold text-[#171717]">訂單資訊</h2>
              <CloseButton />
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1">訂單日期</label>
                <input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#171717] mb-1">匯率（CNY→NTD）</label>
                  <input
                    type="number"
                    step="0.01"
                    value={cnyRate}
                    onChange={(e) => setCnyRate(e.target.value)}
                    className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#171717] mb-1">採購人</label>
                  <input
                    type="text"
                    value={purchaser}
                    onChange={(e) => setPurchaser(e.target.value)}
                    className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1">備註</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="可貼 1688 訂單號"
                  className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
                />
              </div>
            </div>

            <div className="bg-[#FAFAFA] rounded-xl p-3 mt-4 border border-[#EAEAEA] space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-[#666666]">單號</span>
                <span className="font-mono font-medium text-[#171717]">{poNumberPreview || "產生中..."}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666666]">品項</span>
                <span className="text-[#171717]">{items.length} 項</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666666]">CNY 小計</span>
                <span className="font-semibold text-[#171717] tabular-nums">¥{subtotalCny.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666666]">約合 NTD</span>
                <span className="font-semibold text-[#171717] tabular-nums">
                  NT${Math.round(subtotalCny * (Number(cnyRate) || CNY_RATE_DEFAULT)).toLocaleString()}
                </span>
              </div>
            </div>

            {submitError && <p className="text-[#E00] text-sm mt-3">{submitError}</p>}

            <button
              onClick={submit}
              disabled={submitting}
              className="w-full mt-4 py-3.5 rounded-xl text-white font-semibold text-base bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                "建立中..."
              ) : (
                <>
                  <CheckIcon className="w-4 h-4" />
                  建立採購單
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
