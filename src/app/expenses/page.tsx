"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import type { AdCost, OperatingExpense } from "@/lib/database.types";

type Tab = "ads" | "operating";

export default function ExpensesPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("ads");
  const [ads, setAds] = useState<AdCost[]>([]);
  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    expense_date: new Date().toISOString().split("T")[0],
    category: "包材",
    description: "",
    amount: "",
    notes: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);

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

  const addExpense = async () => {
    if (!expenseForm.amount || !expenseForm.description) {
      toast("請填寫金額和說明", "error");
      return;
    }
    setSaving(true);
    try {
      const { error } = await getSupabase().from("operating_expenses").insert({
        expense_date: expenseForm.expense_date,
        category: expenseForm.category,
        description: expenseForm.description,
        amount: Number(expenseForm.amount),
        notes: expenseForm.notes || null,
      });
      if (error) throw error;
      setShowAddExpense(false);
      setExpenseForm({ expense_date: new Date().toISOString().split("T")[0], category: "包材", description: "", amount: "", notes: "" });
      fetchData();
    } catch (e) {
      toast(e instanceof Error ? e.message : "新增失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const totalAds = ads.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

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

          {/* Summary */}
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
                  <div key={a.id} className="bg-white rounded-lg p-3 border border-slate-200 flex justify-between items-center">
                    <div>
                      <div className="text-sm">{a.description || "廣告費"}</div>
                      <div className="text-[11px] text-slate-400">{a.ad_date}</div>
                    </div>
                    <div className="text-sm font-bold text-purple-700">${Number(a.amount).toLocaleString()}</div>
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
              onClick={() => setShowAddExpense(!showAddExpense)}
              className="w-full py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium border border-blue-200 active:bg-blue-100"
            >
              {showAddExpense ? "取消" : "+ 新增營業費用"}
            </button>
          </div>

          {showAddExpense && (
            <div className="bg-blue-50 border-b border-blue-200 px-4 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">日期</label>
                  <input type="date" value={expenseForm.expense_date}
                    onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">類別</label>
                  <select value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="包材">包材</option>
                    <option value="倉儲">倉儲</option>
                    <option value="人事">人事</option>
                    <option value="物流">物流</option>
                    <option value="軟體">軟體</option>
                    <option value="其他">其他</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] text-slate-500 mb-0.5">說明 *</label>
                  <input type="text" value={expenseForm.description}
                    onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
                    placeholder="費用說明" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">金額 (TWD) *</label>
                  <input type="number" value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">備註</label>
                  <input type="text" value={expenseForm.notes}
                    onChange={(e) => setExpenseForm({ ...expenseForm, notes: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
              <button onClick={addExpense} disabled={saving}
                className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-50">
                {saving ? "新增中..." : "新增費用"}
              </button>
            </div>
          )}

          <div className="px-4 py-2">
            {expenses.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">尚無營業費用</div>
            ) : (
              <div className="space-y-1">
                {expenses.map((e) => (
                  <div key={e.id} className="bg-white rounded-lg p-3 border border-slate-200 flex justify-between items-center">
                    <div>
                      <div className="text-sm">{e.description}</div>
                      <div className="flex gap-2 text-[11px] text-slate-400">
                        <span>{e.expense_date}</span>
                        <span className="px-1.5 py-0 bg-slate-100 rounded">{e.category}</span>
                      </div>
                    </div>
                    <div className="text-sm font-bold text-slate-700">${Number(e.amount).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
