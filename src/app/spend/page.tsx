"use client";

// 費用管理（PRD §2.3 #10、§5，取代舊 /expenses）。PRD 初判「現版最健康的頁，小改」——
// 換皮成 Geist 慣例＋列表分頁化＋金額千分位，功能等價搬移（廣告費＋營業費記帳，新增／編輯／
// 刪除保留）。廣告費 CSV 匯入維持一級動作（不像 /sales 那樣降級進工具區——PRD 沒有把這頁
// 列入 S3/S4 病灶，匯入本來就是這頁唯二的新增手段之一，沒有理由藏起來）。
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import type { AdCost, OperatingExpense } from "@/lib/database.types";
import { DEMO_AD_COSTS, DEMO_OPERATING_EXPENSES } from "@/lib/demo-data-app";
import { ExpenseFormSheet, type ExpenseFormValue } from "@/components/app/ExpenseFormSheet";
import { PlusIcon } from "@/components/app/icons";

type Tab = "ads" | "operating";
const PAGE_SIZE = 20;

function money(n: number | null | undefined): string {
  return Math.round(Number(n) || 0).toLocaleString();
}

async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await makeQuery(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

function parseAdsCSV(text: string): Partial<AdCost>[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const findCol = (keywords: string[]) => headers.findIndex((h) => keywords.some((k) => h.includes(k)));

  const colDate = findCol(["日期", "Date", "報表日期"]);
  const colSpend = findCol(["花費", "Cost", "Spend", "廣告花費", "金額"]);
  const colDesc = findCol(["廣告名稱", "Ad Name", "商品", "Campaign"]);

  const results: Partial<AdCost>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of lines[i]) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else current += char;
    }
    values.push(current.trim());

    const getVal = (idx: number) => (idx >= 0 && idx < values.length ? values[idx] : "");
    const spend = Number(getVal(colSpend).replace(/[,$]/g, ""));
    if (!spend) continue;

    results.push({ ad_date: getVal(colDate) || null, amount: spend, description: getVal(colDesc) || null });
  }
  return results;
}

export default function SpendPage() {
  const { isDemo } = useAuth();
  const { toast } = useToast();
  const { confirm } = useConfirm();

  const [tab, setTab] = useState<Tab>("ads");

  const [ads, setAds] = useState<AdCost[]>([]);
  const [adsOffset, setAdsOffset] = useState(0);
  const [adsHasMore, setAdsHasMore] = useState(true);
  const [adsTotal, setAdsTotal] = useState(0);
  const [adsSum, setAdsSum] = useState(0);
  const [adsLoading, setAdsLoading] = useState(true);
  const [adsLoadingMore, setAdsLoadingMore] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [expOffset, setExpOffset] = useState(0);
  const [expHasMore, setExpHasMore] = useState(true);
  const [expTotal, setExpTotal] = useState(0);
  const [expSum, setExpSum] = useState(0);
  const [expLoading, setExpLoading] = useState(true);
  const [expLoadingMore, setExpLoadingMore] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OperatingExpense | undefined>(undefined);

  const loadAds = useCallback(
    async (reset: boolean) => {
      reset ? setAdsLoading(true) : setAdsLoadingMore(true);
      try {
        if (isDemo) {
          setAds(DEMO_AD_COSTS);
          setAdsTotal(DEMO_AD_COSTS.length);
          setAdsSum(DEMO_AD_COSTS.reduce((s, a) => s + (Number(a.amount) || 0), 0));
          setAdsHasMore(false);
          return;
        }
        const supabase = getSupabase();
        const from = reset ? 0 : adsOffset;
        const { data, error, count } = await supabase
          .from("ad_costs")
          .select("*", { count: "exact" })
          .order("ad_date", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = data || [];
        setAds((prev) => (reset ? rows : [...prev, ...rows]));
        setAdsOffset(from + rows.length);
        setAdsTotal(count ?? 0);
        setAdsHasMore(rows.length === PAGE_SIZE);
        if (reset) {
          const all = await fetchAllRows<{ amount: number | null }>((f, t) => supabase.from("ad_costs").select("amount").range(f, t));
          setAdsSum(all.reduce((s, a) => s + (Number(a.amount) || 0), 0));
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : "載入失敗", "error");
      } finally {
        setAdsLoading(false);
        setAdsLoadingMore(false);
      }
    },
    [isDemo, adsOffset, toast]
  );

  const loadExpenses = useCallback(
    async (reset: boolean) => {
      reset ? setExpLoading(true) : setExpLoadingMore(true);
      try {
        if (isDemo) {
          setExpenses(DEMO_OPERATING_EXPENSES);
          setExpTotal(DEMO_OPERATING_EXPENSES.length);
          setExpSum(DEMO_OPERATING_EXPENSES.reduce((s, e) => s + (Number(e.amount) || 0), 0));
          setExpHasMore(false);
          return;
        }
        const supabase = getSupabase();
        const from = reset ? 0 : expOffset;
        const { data, error, count } = await supabase
          .from("operating_expenses")
          .select("*", { count: "exact" })
          .order("expense_date", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = data || [];
        setExpenses((prev) => (reset ? rows : [...prev, ...rows]));
        setExpOffset(from + rows.length);
        setExpTotal(count ?? 0);
        setExpHasMore(rows.length === PAGE_SIZE);
        if (reset) {
          const all = await fetchAllRows<{ amount: number | null }>((f, t) => supabase.from("operating_expenses").select("amount").range(f, t));
          setExpSum(all.reduce((s, e) => s + (Number(e.amount) || 0), 0));
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : "載入失敗", "error");
      } finally {
        setExpLoading(false);
        setExpLoadingMore(false);
      }
    },
    [isDemo, expOffset, toast]
  );

  useEffect(() => {
    loadAds(true);
    loadExpenses(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo]);

  const handleAdsImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = parseAdsCSV(text);
      if (parsed.length === 0) {
        toast("無法解析 CSV", "error");
        return;
      }
      if (isDemo) {
        toast("展示模式，未實際寫入", "info");
        return;
      }
      const { error } = await getSupabase().from("ad_costs").insert(parsed);
      if (error) throw error;
      toast(`成功匯入 ${parsed.length} 筆廣告數據`);
      loadAds(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : "匯入失敗", "error");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const deleteAd = async (id: number) => {
    const ok = await confirm({ title: "刪除廣告費用", message: "確定刪除此筆廣告費用？", confirmText: "刪除", danger: true });
    if (!ok) return;
    if (isDemo) {
      toast("展示模式，未實際寫入", "info");
      return;
    }
    const { error } = await getSupabase().from("ad_costs").delete().eq("id", id);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("已刪除");
    loadAds(true);
  };

  const deleteExpense = async (id: number) => {
    const ok = await confirm({ title: "刪除營業費用", message: "確定刪除此筆營業費用？", confirmText: "刪除", danger: true });
    if (!ok) return;
    if (isDemo) {
      toast("展示模式，未實際寫入", "info");
      return;
    }
    const { error } = await getSupabase().from("operating_expenses").delete().eq("id", id);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("已刪除");
    loadExpenses(true);
  };

  const saveExpense = async (form: ExpenseFormValue) => {
    const payload = {
      expense_date: form.expense_date,
      category: form.category,
      item_name: form.item_name || null,
      quantity: form.quantity ? Number(form.quantity) : 1,
      description: form.description || null,
      amount: Number(form.amount),
      notes: form.notes || null,
    };
    if (isDemo) {
      toast("展示模式，未實際寫入", "info");
      setShowForm(false);
      setEditing(undefined);
      return;
    }
    if (editing) {
      const { error } = await getSupabase().from("operating_expenses").update(payload).eq("id", editing.id);
      if (error) throw error;
      toast("已更新");
    } else {
      const { error } = await getSupabase().from("operating_expenses").insert(payload);
      if (error) throw error;
      toast("已新增");
    }
    setShowForm(false);
    setEditing(undefined);
    loadExpenses(true);
  };

  return (
    <div className="min-h-screen bg-white">
      {isDemo && (
        <div className="bg-[#F5A623] text-[#171717] text-xs text-center py-1 font-medium">展示模式 — 資料為模擬</div>
      )}

      <header className="px-5 pt-6 pb-3 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">費用</h1>
        <p className="text-sm text-[#8F8F8F] mt-0.5">
          廣告 ${money(adsSum)} · 營業 ${money(expSum)}
        </p>
      </header>

      <div className="px-5 max-w-2xl mx-auto flex gap-1 bg-[#FAFAFA] p-1 rounded-xl border border-[#EAEAEA] mb-4">
        {(["ads", "operating"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 min-h-10 rounded-lg text-sm font-medium transition-colors duration-150 ${
              tab === t ? "bg-white text-[#171717] shadow-sm" : "text-[#8F8F8F]"
            }`}
          >
            {t === "ads" ? `廣告費用（${adsTotal}）` : `營業費用（${expTotal}）`}
          </button>
        ))}
      </div>

      <main className="px-5 max-w-2xl mx-auto pb-10">
        {tab === "ads" ? (
          <div className="space-y-4 app-fade-up-enter">
            <label className="block w-full py-3 rounded-xl bg-[#FAFAFA] text-[#171717] text-sm font-medium border border-dashed border-[#EAEAEA] text-center cursor-pointer hover:border-[#171717] transition-colors duration-150">
              {importing ? "匯入中..." : "匯入蝦皮廣告 CSV"}
              <input ref={fileRef} type="file" accept=".csv" onChange={handleAdsImport} className="hidden" disabled={importing} />
            </label>

            {adsLoading ? (
              <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
            ) : ads.length === 0 ? (
              <p className="text-center text-sm text-[#8F8F8F] py-12">尚無廣告數據</p>
            ) : (
              <>
                <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
                  {ads.map((a) => (
                    <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#171717] truncate">{a.description || "廣告費"}</p>
                        <p className="text-[11px] text-[#8F8F8F] mt-0.5">{a.ad_date}</p>
                      </div>
                      <span className="text-sm font-semibold text-[#171717] tabular-nums flex-shrink-0">${money(a.amount)}</span>
                      <button onClick={() => deleteAd(a.id)} className="text-[#E00] text-xs flex-shrink-0 hover:underline">
                        刪除
                      </button>
                    </div>
                  ))}
                </div>
                {adsHasMore && (
                  <button
                    onClick={() => loadAds(false)}
                    disabled={adsLoadingMore}
                    className="w-full py-2.5 text-sm text-[#0070F3] hover:underline disabled:opacity-50"
                  >
                    {adsLoadingMore ? "載入中..." : `載入更多（已顯示 ${ads.length}／${adsTotal}）`}
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4 app-fade-up-enter">
            <button
              onClick={() => {
                setEditing(undefined);
                setShowForm(true);
              }}
              className="w-full py-3 rounded-xl bg-[#171717] text-white text-sm font-medium active:scale-[0.98] transition-transform duration-150 flex items-center justify-center gap-1.5"
            >
              <PlusIcon className="w-4 h-4" />
              新增營業費用
            </button>

            {expLoading ? (
              <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
            ) : expenses.length === 0 ? (
              <p className="text-center text-sm text-[#8F8F8F] py-12">尚無營業費用</p>
            ) : (
              <>
                <div className="space-y-2">
                  {expenses.map((e) => {
                    const qty = Number(e.quantity) || 1;
                    const amt = Number(e.amount) || 0;
                    const unitPrice = qty > 0 ? amt / qty : amt;
                    return (
                      <div key={e.id} className="rounded-2xl border border-[#EAEAEA] p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[#171717] truncate">{e.item_name || e.description || "—"}</p>
                            <div className="flex items-center gap-2 flex-wrap mt-0.5">
                              <span className="text-[11px] text-[#8F8F8F]">{e.expense_date}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FAFAFA] border border-[#EAEAEA] text-[#666666]">
                                {e.category}
                              </span>
                              {qty > 1 && <span className="text-[11px] text-[#8F8F8F] tabular-nums">{qty} 個 × ${unitPrice.toFixed(0)}</span>}
                            </div>
                            {e.notes && <p className="text-[11px] text-[#8F8F8F] mt-0.5 truncate">{e.notes}</p>}
                          </div>
                          <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                            <p className="text-sm font-semibold text-[#171717] tabular-nums">${money(amt)}</p>
                            <div className="flex gap-2 text-xs">
                              <button
                                onClick={() => {
                                  setEditing(e);
                                  setShowForm(true);
                                }}
                                className="text-[#0070F3] hover:underline"
                              >
                                編輯
                              </button>
                              <button onClick={() => deleteExpense(e.id)} className="text-[#E00] hover:underline">
                                刪除
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {expHasMore && (
                  <button
                    onClick={() => loadExpenses(false)}
                    disabled={expLoadingMore}
                    className="w-full py-2.5 text-sm text-[#0070F3] hover:underline disabled:opacity-50"
                  >
                    {expLoadingMore ? "載入中..." : `載入更多（已顯示 ${expenses.length}／${expTotal}）`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {showForm && (
        <ExpenseFormSheet
          editing={editing}
          onSave={saveExpense}
          onClose={() => {
            setShowForm(false);
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
