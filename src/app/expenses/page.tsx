"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import type { AdCost, OperatingExpense } from "@/lib/database.types";

type Tab = "ads" | "operating";

const CATEGORIES = ["包材", "倉儲", "人事", "物流", "軟體", "設備", "其他"];

const QUICK_DATES: { label: string; getValue: () => string }[] = [
  { label: "今天", getValue: () => new Date().toISOString().slice(0, 10) },
  { label: "昨天", getValue: () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); } },
  { label: "本月1日", getValue: () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); } },
];

export default function ExpensesPage() {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [tab, setTab] = useState<Tab>("ads");
  const [ads, setAds] = useState<AdCost[]>([]);
  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expenseForm, setExpenseForm] = useState({
    expense_date: new Date().toISOString().slice(0, 10),
    category: "包材",
    item_name: "",
    quantity: "1",
    description: "",
    amount: "",
    notes: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const resetForm = () => setExpenseForm({
    expense_date: new Date().toISOString().slice(0, 10),
    category: "包材",
    item_name: "",
    quantity: "1",
    description: "",
    amount: "",
    notes: "",
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [adsRes, expRes] = await Promise.all([
        getSupabase().from("ad_costs").select("*").order("ad_date", { ascending: false }),
        getSupabase().from("operating_expenses").select("*").order("expense_date", { ascending: false }),
      ]);
      if (adsRes.error) throw adsRes.error;
      if (expRes.error) throw expRes.error;
      setAds(adsRes.data || []);
      setExpenses(expRes.data || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const parseAdsCSV = (text: string): Partial<AdCost>[] => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
    const findCol = (keywords: string[]) =>
      headers.findIndex((h) => keywords.some((k) => h.includes(k)));

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
        else if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; }
        else current += char;
      }
      values.push(current.trim());

      const getVal = (idx: number) => (idx >= 0 && idx < values.length ? values[idx] : "");
      const spend = Number(getVal(colSpend).replace(/[,$]/g, ""));
      if (!spend) continue;

      results.push({
        ad_date: getVal(colDate) || null,
        amount: spend,
        description: getVal(colDesc) || null,
      });
    }
    return results;
  };

  const handleAdsImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const parsed = parseAdsCSV(text);
      if (parsed.length === 0) {
        setImportResult("無法解析 CSV");
        return;
      }
      const { error } = await getSupabase().from("ad_costs").insert(parsed);
      if (error) throw error;
      setImportResult(`成功匯入 ${parsed.length} 筆廣告數據`);
      fetchData();
    } catch (e) {
      setImportResult(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveExpense = async () => {
    if (!expenseForm.amount || !expenseForm.item_name) {
      toast("請填寫品項名稱和總價", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        expense_date: expenseForm.expense_date,
        category: expenseForm.category,
        item_name: expenseForm.item_name || null,
        quantity: expenseForm.quantity ? Number(expenseForm.quantity) : 1,
        description: expenseForm.description || null,
        amount: Number(expenseForm.amount),
        notes: expenseForm.notes || null,
      };

      if (editingId) {
        const { error } = await getSupabase().from("operating_expenses").update(payload).eq("id", editingId);
        if (error) throw error;
        toast("已更新");
      } else {
        const { error } = await getSupabase().from("operating_expenses").insert(payload);
        if (error) throw error;
        toast("已新增");
      }
      setShowAddExpense(false);
      setEditingId(null);
      resetForm();
      fetchData();
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (exp: OperatingExpense) => {
    setEditingId(exp.id);
    setExpenseForm({
      expense_date: exp.expense_date || new Date().toISOString().slice(0, 10),
      category: exp.category || "其他",
      item_name: exp.item_name || exp.description || "",
      quantity: String(exp.quantity || 1),
      description: exp.description || "",
      amount: String(exp.amount || ""),
      notes: exp.notes || "",
    });
    setShowAddExpense(true);
  };

  const cancelEdit = () => {
    setShowAddExpense(false);
    setEditingId(null);
    resetForm();
  };

  const deleteAd = async (id: number) => {
    const ok = await confirm({ title: "刪除廣告費用", message: "確定刪除此筆廣告費用？", confirmText: "刪除", danger: true });
    if (!ok) return;
    const { error } = await getSupabase().from("ad_costs").delete().eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    toast("已刪除");
    fetchData();
  };

  const deleteExpense = async (id: number) => {
    const ok = await confirm({ title: "刪除營業費用", message: "確定刪除此筆營業費用？", confirmText: "刪除", danger: true });
    if (!ok) return;
    const { error } = await getSupabase().from("operating_expenses").delete().eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    toast("已刪除");
    fetchData();
  };

  const totalAds = ads.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const unitPrice = Number(expenseForm.amount) && Number(expenseForm.quantity)
    ? (Number(expenseForm.amount) / Number(expenseForm.quantity)).toFixed(1)
    : "—";

  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/" className="text-xl">&larr;</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold">費用管理</h1>
          <p className="text-xs text-slate-300">
            廣告 ${totalAds.toLocaleString()} | 營業 ${totalExpenses.toLocaleString()}
          </p>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex bg-white border-b">
        <button
          onClick={() => setTab("ads")}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === "ads" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400"
          }`}
        >
          廣告費用 ({ads.length})
        </button>
        <button
          onClick={() => setTab("operating")}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === "operating" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400"
          }`}
        >
          營業費用 ({expenses.length})
        </button>
      </div>

      {/* Ads Tab */}
      {tab === "ads" && (
        <div>
          <div className="px-4 py-3 bg-white border-b">
            <label className="block w-full py-3 rounded-xl bg-purple-50 text-purple-700 text-sm font-medium border-2 border-dashed border-purple-300 text-center cursor-pointer hover:bg-purple-100 transition-colors">
              {importing ? "匯入中..." : "匯入蝦皮廣告 CSV"}
              <input ref={fileRef} type="file" accept=".csv" onChange={handleAdsImport} className="hidden" disabled={importing} />
            </label>
            {importResult && (
              <p className={`text-xs mt-2 text-center ${importResult.includes("成功") ? "text-emerald-600" : "text-amber-600"}`}>
                {importResult}
              </p>
            )}
          </div>

          {ads.length > 0 && (
            <div className="px-4 py-2 bg-slate-50 border-b text-center">
              <span className="text-sm font-bold text-purple-700">總廣告費 ${totalAds.toLocaleString()}</span>
            </div>
          )}

          <div className="px-4 py-2">
            {loading ? (
              <div className="text-center py-12 text-slate-400">載入中...</div>
            ) : ads.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">尚無廣告數據</div>
            ) : (
              <div className="space-y-1">
                {ads.map((a) => (
                  <div key={a.id} className="bg-white rounded-lg p-3 border border-slate-200 flex justify-between items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{a.description || "廣告費"}</div>
                      <div className="text-[11px] text-slate-400">{a.ad_date}</div>
                    </div>
                    <div className="text-sm font-bold text-purple-700 flex-shrink-0">${Number(a.amount).toLocaleString()}</div>
                    <button onClick={() => deleteAd(a.id)} className="text-red-400 hover:text-red-600 text-xs flex-shrink-0 ml-1">
                      刪除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Operating Tab */}
      {tab === "operating" && (
        <div>
          <div className="px-4 py-3 bg-white border-b">
            <button
              onClick={() => { if (showAddExpense) cancelEdit(); else setShowAddExpense(true); }}
              className="w-full py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium border border-blue-200 active:bg-blue-100"
            >
              {showAddExpense ? "取消" : "+ 新增營業費用"}
            </button>
          </div>

          {showAddExpense && (
            <div className="bg-blue-50 border-b border-blue-200 px-4 py-4 space-y-3">
              <h3 className="text-sm font-bold text-blue-800">
                {editingId ? "編輯營業費用" : "新增營業費用"}
              </h3>
              {/* Date with quick buttons */}
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">日期</label>
                <div className="flex gap-2 items-center">
                  <input type="date" value={expenseForm.expense_date}
                    onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })}
                    className="flex-1 px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                  {QUICK_DATES.map((qd) => (
                    <button key={qd.label}
                      onClick={() => setExpenseForm({ ...expenseForm, expense_date: qd.getValue() })}
                      className={`text-[10px] px-2 py-1.5 rounded border flex-shrink-0 ${
                        expenseForm.expense_date === qd.getValue()
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-500 border-slate-200"
                      }`}
                    >
                      {qd.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">類別</label>
                  <select value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">品項名稱 *</label>
                  <input type="text" value={expenseForm.item_name}
                    onChange={(e) => setExpenseForm({ ...expenseForm, item_name: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                    placeholder="例：氣泡袋、標籤機" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">數量</label>
                  <input type="number" min="1" value={expenseForm.quantity}
                    onChange={(e) => setExpenseForm({ ...expenseForm, quantity: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">總價 (TWD) *</label>
                  <input type="number" value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
              {/* Unit price display */}
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-white rounded-lg px-3 py-2 border">
                <span>單價</span>
                <span className="font-bold text-slate-700">${unitPrice}</span>
                <span className="text-[10px] text-slate-400">= 總價 ÷ 數量（自動計算）</span>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">備註</label>
                <input type="text" value={expenseForm.notes}
                  onChange={(e) => setExpenseForm({ ...expenseForm, notes: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="選填" />
              </div>
              <div className="flex gap-2">
                <button onClick={saveExpense} disabled={saving}
                  className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50">
                  {saving ? "儲存中..." : editingId ? "更新" : "新增"}
                </button>
                <button onClick={cancelEdit}
                  className="flex-1 py-2 rounded-lg bg-slate-200 text-slate-600 text-sm font-medium active:bg-slate-300">
                  取消
                </button>
              </div>
            </div>
          )}

          {/* Summary */}
          {expenses.length > 0 && (
            <div className="px-4 py-2 bg-slate-50 border-b text-center">
              <span className="text-sm font-bold text-slate-700">總營業費用 ${totalExpenses.toLocaleString()}</span>
            </div>
          )}

          <div className="px-4 py-2">
            {expenses.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">尚無營業費用</div>
            ) : (
              <div className="space-y-1">
                {expenses.map((e) => {
                  const qty = Number(e.quantity) || 1;
                  const amt = Number(e.amount) || 0;
                  const uPrice = qty > 0 ? amt / qty : amt;
                  return (
                    <div key={e.id} className="bg-white rounded-lg p-3 border border-slate-200">
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{e.item_name || e.description || "—"}</div>
                          <div className="flex gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                            <span>{e.expense_date}</span>
                            <span className="px-1.5 py-0 bg-slate-100 rounded">{e.category}</span>
                            {qty > 1 && <span>{qty} 個 × ${uPrice.toFixed(0)}</span>}
                          </div>
                          {e.notes && <div className="text-[10px] text-slate-400 mt-0.5 truncate">{e.notes}</div>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="text-sm font-bold text-slate-700">${amt.toLocaleString()}</div>
                          <button onClick={() => startEdit(e)} className="text-blue-400 hover:text-blue-600 text-xs">
                            編輯
                          </button>
                          <button onClick={() => deleteExpense(e.id)} className="text-red-400 hover:text-red-600 text-xs">
                            刪除
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
