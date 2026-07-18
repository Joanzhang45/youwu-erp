"use client";

// 選品候選（PRD §5 任務④）——進貨鏈的起點，掛在 /inbound 首頁下半段。
// 刻意保持精簡：狀態篩選＋分頁列表＋detail 用 query param，不照搬舊版 /selections 全部
// CRUD 欄位；款式新增／競品新增這類低頻能力隨舊頁一起退場（M5），核心欄位（狀態／備註）
// 改在 SelectionCandidateDetail 內就地編輯，見下方「編輯」區塊。
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { CompetitorProduct, ProductSelection, ProductVariant } from "@/lib/database.types";
import { ChevronRightIcon, CheckIcon, PlusIcon } from "./icons";

// 本地日期字串（不經過 toISOString 的 UTC 轉換，同 ExpenseFormSheet／PurchaseOrderFormSheet
// 慣例——台北 UTC+8，00:00~07:59 本地時間用 toISOString().slice(0,10) 會退回前一天）。
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 沿用舊 /selections/detail 的狀態選項（+ 該頁缺漏的「評估中」，見 STATUS_BADGE 實際會出現的
// 8 種狀態），M5 死循環修復用：舊版編輯連結退場後，狀態／備註在這裡直接可改。
const EDIT_STATUS_OPTIONS = ["評估中", "考慮中", "測品", "預購", "已下單", "已通過", "不進貨", "已放棄"];

const STATUS_BADGE: Record<string, string> = {
  評估中: "bg-[#0070F3]/10 text-[#0070F3] border-[#0070F3]/30",
  考慮中: "bg-[#0070F3]/10 text-[#0070F3] border-[#0070F3]/30",
  測品: "bg-[#F5A623]/10 text-[#F5A623] border-[#F5A623]/30",
  已通過: "bg-[#0CCE6B]/10 text-[#0CCE6B] border-[#0CCE6B]/30",
  預購: "bg-[#0CCE6B]/10 text-[#0CCE6B] border-[#0CCE6B]/30",
  已下單: "bg-[#0CCE6B]/10 text-[#0CCE6B] border-[#0CCE6B]/30",
  已放棄: "bg-[#FAFAFA] text-[#8F8F8F] border-[#EAEAEA]",
  不進貨: "bg-[#FAFAFA] text-[#8F8F8F] border-[#EAEAEA]",
};

const PAGE_SIZE = 20;

export function SelectionCandidatesSection() {
  const { toast } = useToast();
  const [selections, setSelections] = useState<ProductSelection[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("全部");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [showAdd, setShowAdd] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      // 選品評估是低頻動作（PRD §2.3：進貨重啟前低頻），實測全量僅 99 筆，遠低於長牆病門檻，
      // 一次抓全量＋前端分頁即可，不需要伺服器端 range() 分頁的額外複雜度。
      const { data, error } = await getSupabase()
        .from("product_selections")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setSelections(data || []);
    } catch {
      setSelections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statusOptions = useMemo(() => {
    const set = new Set(selections.map((s) => s.status).filter(Boolean) as string[]);
    return ["全部", ...Array.from(set)];
  }, [selections]);

  const filtered = useMemo(() => {
    if (statusFilter === "全部") return selections;
    return selections.filter((s) => s.status === statusFilter);
  }, [selections, statusFilter]);

  const visible = filtered.slice(0, visibleCount);

  const createCandidate = async (form: CandidateFormValue) => {
    const { error } = await getSupabase()
      .from("product_selections")
      .insert({
        product_name: form.product_name.trim(),
        order_link: form.order_link.trim() || null,
        order_amount_cny: form.order_amount_cny ? Number(form.order_amount_cny) : null,
        notes: form.notes.trim() || null,
        status: "考慮中",
        selection_date: todayLocal(),
      });
    if (error) throw error;
    setShowAdd(false);
    toast("已新增選品候選");
    fetchData();
  };

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-xs font-medium text-[#8F8F8F]">選品候選</p>
        <div className="flex items-center gap-3">
          <p className="text-[11px] text-[#8F8F8F]">{filtered.length} 筆</p>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 text-[11px] text-[#0070F3] font-medium">
            <PlusIcon className="w-3.5 h-3.5" />
            新增候選
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
        {statusOptions.map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatusFilter(s);
              setVisibleCount(PAGE_SIZE);
            }}
            className={`flex-shrink-0 min-h-9 px-3 rounded-full border text-xs transition-colors duration-150 ${
              statusFilter === s
                ? "bg-[#171717] text-white border-[#171717]"
                : "bg-white text-[#666666] border-[#EAEAEA] hover:border-[#171717]"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-[#8F8F8F] text-sm">載入中...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#EAEAEA] p-6 text-center">
          <p className="text-sm text-[#8F8F8F]">沒有符合的選品候選</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
            {visible.map((s) => (
              <Link
                key={s.id}
                href={`/inbound?selection_id=${s.id}`}
                className="flex items-center gap-3 px-3.5 py-3 hover:bg-[#FAFAFA] transition-colors duration-150"
              >
                {s.product_image ? (
                  <img src={s.product_image} alt="" className="w-11 h-11 rounded-lg object-cover bg-[#FAFAFA] flex-shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-[#FAFAFA] flex items-center justify-center flex-shrink-0 text-lg">📦</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#171717] truncate">{s.product_name || "未命名"}</p>
                  <p className="text-xs text-[#8F8F8F] truncate">
                    {s.category || "未分類"}
                    {s.total_purchase_cost_ntd ? ` · NT$${Math.round(s.total_purchase_cost_ntd).toLocaleString()}` : ""}
                  </p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 font-medium ${STATUS_BADGE[s.status || ""] || ""}`}>
                  {s.status || "-"}
                </span>
                <ChevronRightIcon className="w-4 h-4 text-[#8F8F8F] flex-shrink-0" />
              </Link>
            ))}
          </div>
          {filtered.length > visible.length && (
            <button
              onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
              className="w-full mt-3 py-2.5 text-sm text-[#0070F3] hover:underline"
            >
              載入更多（還有 {filtered.length - visible.length} 筆）
            </button>
          )}
        </>
      )}

      {showAdd && <SelectionCandidateFormSheet onCreate={createCandidate} onClose={() => setShowAdd(false)} />}
    </section>
  );
}

type CandidateFormValue = {
  product_name: string;
  order_link: string;
  order_amount_cny: string;
  notes: string;
};

const CANDIDATE_INITIAL: CandidateFormValue = { product_name: "", order_link: "", order_amount_cny: "", notes: "" };

// 新增選品候選（改版時漏搬的建單流程起點，2026-07-18 補；PRD §5 任務④的入口）。
// 視覺沿用 ProductFormSheet／ExpenseFormSheet 的 bottom sheet 慣例，欄位刻意精簡
// （品名／連結／預估成本／備註）——款式、競品等低頻欄位仍走 SelectionCandidateDetail
// 就地編輯或日後補值，不在「快速留一筆候選」這個第一步塞進去。
export function SelectionCandidateFormSheet({
  onCreate,
  onClose,
}: {
  onCreate: (form: CandidateFormValue) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CandidateFormValue>(CANDIDATE_INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!form.product_name.trim()) {
      setError("請輸入品名");
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

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-[#EAEAEA] p-5 app-sheet-enter">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#171717]">新增選品候選</h2>
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
            <label className="block text-xs font-medium text-[#171717] mb-1">品名 *</label>
            <input
              type="text"
              value={form.product_name}
              onChange={(e) => setForm({ ...form, product_name: e.target.value })}
              placeholder="例：矽藻土杯墊"
              className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">1688／淘寶連結</label>
            <input
              type="text"
              value={form.order_link}
              onChange={(e) => setForm({ ...form, order_link: e.target.value })}
              placeholder="選填"
              className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">預估成本（CNY）</label>
            <input
              type="number"
              value={form.order_amount_cny}
              onChange={(e) => setForm({ ...form, order_amount_cny: e.target.value })}
              placeholder="選填"
              className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">備註</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="選填"
              className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
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
            "新增中..."
          ) : (
            <>
              <CheckIcon className="w-4 h-4" />
              新增候選
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function SelectionCandidateDetail({ id }: { id: number }) {
  const { toast } = useToast();
  const [selection, setSelection] = useState<ProductSelection | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // M5 死循環修復：舊「在舊版選品詳情編輯 →」連結指向即將退場的 /selections/detail，
  // redirect 後會轉一圈繞回 /inbound（死循環）。沿用舊頁核心欄位（狀態／備註）做輕量編輯，
  // 不搬舊頁款式／競品 CRUD（那些走款式/競品專用區塊，不是本次死循環修復範圍）。
  const [editStatus, setEditStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const supabase = getSupabase();
      const [selRes, varRes, compRes] = await Promise.all([
        supabase.from("product_selections").select("*").eq("id", id).single(),
        supabase.from("product_variants").select("*").eq("selection_id", id).order("created_at"),
        supabase.from("competitor_products").select("*").eq("selection_id", id),
      ]);
      if (selRes.error || !selRes.data) {
        setNotFound(true);
        return;
      }
      setSelection(selRes.data);
      setEditStatus(selRes.data.status || "");
      setEditNotes(selRes.data.notes || "");
      setVariants(varRes.data || []);
      setCompetitors(compRes.data || []);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleSaveEdit = async () => {
    if (!selection) return;
    setSaving(true);
    try {
      const { error } = await getSupabase()
        .from("product_selections")
        .update({ status: editStatus || null, notes: editNotes || null })
        .eq("id", selection.id);
      if (error) throw error;
      toast("已儲存");
      fetchDetail();
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-[#8F8F8F] text-sm">載入中...</div>;
  }

  if (notFound || !selection) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-[#E00] mb-3 text-sm">找不到這筆選品候選</p>
          <Link href="/inbound" className="text-[#0070F3] text-sm underline">
            返回進貨列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white app-fade-up-enter">
      <header className="px-5 pt-5 pb-3 max-w-2xl mx-auto">
        <Link href="/inbound" className="text-xs text-[#0070F3] hover:underline">
          ← 進貨
        </Link>
        <h1 className="text-xl font-semibold text-[#171717] tracking-tight mt-1">{selection.product_name || "未命名"}</h1>
        <p className="text-sm text-[#8F8F8F] mt-0.5">
          {selection.selection_number} · {selection.selection_date || "-"}
        </p>
      </header>

      {/* pb-24：同批修復 A10 R1 Blocker，末尾編輯區塊與底部導覽列間淨空加大 */}
      <main className="px-5 max-w-2xl mx-auto pb-24 space-y-4">
        <section className="rounded-2xl border border-[#EAEAEA] p-4">
          {selection.product_image && (
            <img src={selection.product_image} alt="" className="w-full h-40 object-cover rounded-xl bg-[#FAFAFA] mb-3" />
          )}
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${STATUS_BADGE[selection.status || ""] || ""}`}>
              {selection.status || "-"}
            </span>
            {selection.category && <span className="text-xs text-[#8F8F8F]">{selection.category}</span>}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoItem
              label="採購成本"
              value={selection.total_purchase_cost_ntd ? `NT$${Math.round(selection.total_purchase_cost_ntd).toLocaleString()}` : null}
            />
            <InfoItem label="訂購金額" value={selection.order_amount_cny ? `¥${selection.order_amount_cny.toLocaleString()}` : null} />
            <InfoItem
              label="數量／重量"
              value={selection.total_qty != null ? `${selection.total_qty} 件 / ${selection.total_weight_kg ?? "-"}kg` : null}
            />
            <InfoItem
              label="競品價格帶"
              value={
                selection.competitor_min_price != null && selection.competitor_max_price != null
                  ? `$${selection.competitor_min_price}~$${selection.competitor_max_price}`
                  : null
              }
            />
            <InfoItem label="運送方式" value={selection.shipping_method} />
            <InfoItem label="銷售模式" value={selection.sales_mode} />
          </div>
          {selection.notes && <p className="text-xs text-[#8F8F8F] mt-3 border-t border-[#EAEAEA] pt-3">{selection.notes}</p>}
        </section>

        {variants.length > 0 && (
          <section>
            <p className="text-xs font-medium text-[#8F8F8F] mb-2 px-1">款式（{variants.length}）</p>
            <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
              {variants.map((v) => (
                <div key={v.id} className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-[#171717] truncate">{v.variant_name || "未命名款式"}</p>
                  <p className="text-xs text-[#8F8F8F] tabular-nums flex-shrink-0">
                    {v.selling_price_ntd ? `NT$${Math.round(v.selling_price_ntd).toLocaleString()}` : "-"}
                    {v.margin_pct != null ? ` · ${(v.margin_pct * 100).toFixed(0)}%` : ""}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {competitors.length > 0 && (
          <section>
            <p className="text-xs font-medium text-[#8F8F8F] mb-2 px-1">競品參考（{competitors.length}）</p>
            <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
              {competitors.map((c) => (
                <div key={c.id} className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-[#171717] truncate">{c.competitor_name || "未命名"}</p>
                  <p className="text-xs text-[#8F8F8F] tabular-nums flex-shrink-0">
                    {c.competitor_price ? `$${c.competitor_price.toLocaleString()}` : "-"}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 編輯（M5 死循環修復）：舊版連結指向即將退場的 /selections/detail，改成沿用
            舊頁核心欄位（狀態／備註）就地編輯，不必再繞出這個頁面。款式／競品的新增與刪除
            仍是舊頁專屬能力，低頻操作暫不搬（進貨重啟前才會用到，見 PRD §2.3 #12）。 */}
        <section className="rounded-2xl border border-[#EAEAEA] p-4 space-y-3">
          <p className="text-xs font-medium text-[#8F8F8F]">編輯</p>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">狀態</label>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150 bg-white"
            >
              <option value="">未設定</option>
              {EDIT_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">備註</label>
            <input
              type="text"
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              className="w-full px-3 py-2 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
              placeholder="選填"
            />
          </div>
          <button
            onClick={handleSaveEdit}
            disabled={saving}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? "儲存中..." : (
              <>
                <CheckIcon className="w-4 h-4" />
                儲存變更
              </>
            )}
          </button>
        </section>
      </main>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] text-[#8F8F8F]">{label}</p>
      <p className="text-sm text-[#171717] font-medium mt-0.5">{value}</p>
    </div>
  );
}
