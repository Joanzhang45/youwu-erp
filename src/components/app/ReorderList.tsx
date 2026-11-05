"use client";

// 補貨清單（/stock?reorder=1）。數字來自資料庫 view v_reorder_suggestions（migration 014）：
// 日均 = 最新訂單日往回 60 天賣出 ÷ 60；建議叫貨量 = 日均 ×（到貨天數 + 30 天）− 庫存 − 已叫未到，
// 且至少補到安全庫存。訂單是批次匯入，所以畫面標出「銷售資料截至哪天」。
import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

type Row = {
  product_id: number;
  product_name: string;
  variant_name: string | null;
  product_image: string | null;
  stock_qty: number;
  on_order_qty: number;
  sold_60d: number;
  daily_sales: number;
  lead_days: number;
  days_left: number | null;
  suggest_qty: number;
  sales_data_until: string;
};

export function ReorderList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    setRows(null);
    const { data, error: err } = await getSupabase()
      .from("v_reorder_suggestions")
      .select("*")
      .gt("suggest_qty", 0)
      .order("days_left", { ascending: true, nullsFirst: false })
      .order("suggest_qty", { ascending: false });
    if (err) {
      setError(err.message);
      return;
    }
    setRows((data || []) as Row[]);
  };

  useEffect(() => {
    load();
  }, []);

  const until = rows?.[0]?.sales_data_until;

  return (
    <div className="min-h-screen bg-white app-fade-up-enter">
      <header className="px-5 pt-5 pb-3 max-w-2xl mx-auto">
        <Link href="/stock" className="text-xs text-[#0070F3] hover:underline">
          ← 庫存
        </Link>
        <h1 className="text-xl font-semibold text-[#171717] tracking-tight mt-1">該補貨的商品</h1>
        <p className="text-xs text-[#8F8F8F] mt-1">
          依近 60 天賣出速度，算到下一批貨到之前再多備 30 天。已叫貨還沒到的也扣掉了。
          {until && <> 銷售資料截至 {until}。</>}
        </p>
      </header>
      <main className="px-5 max-w-2xl mx-auto pb-24">
        {error ? (
          <div className="rounded-2xl border border-[#FFD6D6] bg-[#FFF5F5] p-5 text-center">
            <p className="text-sm font-medium text-[#C00]">資料沒有讀到</p>
            <p className="text-xs text-[#8F8F8F] mt-1 break-all">{error}</p>
            <button onClick={load} className="mt-4 px-4 py-2 rounded-lg bg-[#171717] text-white text-sm font-medium">
              重新讀取
            </button>
          </div>
        ) : rows === null ? (
          <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-[#8F8F8F] text-sm">目前沒有需要補貨的商品</div>
        ) : (
          <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
            {rows.map((r) => (
              <Link
                key={r.product_id}
                href={`/catalog?id=${r.product_id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] transition-colors duration-150"
              >
                {r.product_image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.product_image} alt="" className="w-10 h-10 rounded-lg object-cover bg-[#FAFAFA] flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-[#FAFAFA] flex items-center justify-center flex-shrink-0">📦</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#171717] truncate">{r.product_name}</p>
                  {r.variant_name && <p className="text-xs text-[#8F8F8F] truncate">{r.variant_name}</p>}
                  <p className="text-[11px] text-[#8F8F8F] mt-0.5">
                    庫存 {r.stock_qty}
                    {r.on_order_qty > 0 && ` · 已叫 ${r.on_order_qty}`} · 60 天賣 {r.sold_60d}
                    {r.days_left != null && (
                      <span className={r.days_left <= r.lead_days ? "text-[#E00]" : ""}> · 約剩 {r.days_left} 天</span>
                    )}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-semibold text-[#171717] tabular-nums">{r.suggest_qty}</p>
                  <p className="text-[10px] text-[#8F8F8F]">建議叫貨</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
