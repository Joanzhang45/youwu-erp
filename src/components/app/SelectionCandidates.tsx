"use client";

// 選品候選（PRD §5 任務④）——進貨鏈的起點，掛在 /inbound 首頁下半段。
// 刻意保持精簡：狀態篩選＋分頁列表＋detail 用 query param，不照搬舊版 /selections 全部
// CRUD 欄位（新增/編輯表單仍留在舊版 /selections、/selections/detail，M5 前不動）。
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import type { CompetitorProduct, ProductSelection, ProductVariant } from "@/lib/database.types";
import { DEMO_PRODUCT_SELECTIONS } from "@/lib/demo-data-app";
import { ChevronRightIcon } from "./icons";

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
  const { isDemo } = useAuth();
  const [selections, setSelections] = useState<ProductSelection[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("全部");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const fetchData = useCallback(async () => {
    if (isDemo) {
      setSelections(DEMO_PRODUCT_SELECTIONS);
      setLoading(false);
      return;
    }
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
  }, [isDemo]);

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

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-xs font-medium text-[#8F8F8F]">選品候選</p>
        <p className="text-[11px] text-[#8F8F8F]">{filtered.length} 筆</p>
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
    </section>
  );
}

export function SelectionCandidateDetail({ id }: { id: number }) {
  const { isDemo } = useAuth();
  const [selection, setSelection] = useState<ProductSelection | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      if (isDemo) {
        const found = DEMO_PRODUCT_SELECTIONS.find((s) => s.id === id) || null;
        if (!active) return;
        if (!found) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setSelection(found);
        setVariants([]);
        setCompetitors([]);
        setLoading(false);
        return;
      }
      try {
        const supabase = getSupabase();
        const [selRes, varRes, compRes] = await Promise.all([
          supabase.from("product_selections").select("*").eq("id", id).single(),
          supabase.from("product_variants").select("*").eq("selection_id", id).order("created_at"),
          supabase.from("competitor_products").select("*").eq("selection_id", id),
        ]);
        if (!active) return;
        if (selRes.error || !selRes.data) {
          setNotFound(true);
          return;
        }
        setSelection(selRes.data);
        setVariants(varRes.data || []);
        setCompetitors(compRes.data || []);
      } catch {
        if (active) setNotFound(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, isDemo]);

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

      {/* pb-24：同批修復 A10 R1 Blocker，末尾「在舊版選品詳情編輯」連結與底部導覽列間淨空加大 */}
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

        <Link href={`/selections/detail?id=${selection.id}`} className="block text-center text-sm text-[#0070F3] hover:underline py-2">
          在舊版選品詳情編輯 →
        </Link>
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
