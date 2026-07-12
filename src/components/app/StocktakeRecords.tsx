"use client";

// 盤點紀錄回查（PRD §4.3、A14「差異清單留檔可查」）。資料源是 stock_snapshots——每次盤點
// 對「有輸入實際數量」的品項都各寫一筆（不論有無差異），note 已含人話版「帳上 X → 實際 Y」，
// 所以這裡不用回頭 join inventory_ledger 也能還原完整故事。
// 批次鍵：同一次盤點在 StocktakeFlow 是「一次 insert() 呼叫」，Postgres 對同一語句內多筆 now()
// 預設值給同一個時間戳，所以用 created_at 精確字串分組即可還原「哪些列屬於同一次盤點」，
// 不需要额外欄位、也不受「同一天盤兩次」影響（snapshot_date 是日期粒度會混在一起，
// created_at 是完整時間戳不會）。
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/Toast";

type SnapshotRow = { id: number; product_id: number; counted_qty: number; snapshot_date: string; note: string | null; created_at: string };
type ProductLite = { id: number; product_name: string; variant_name: string | null };

type Session = {
  key: string;
  snapshotDate: string;
  rows: SnapshotRow[];
  diffCount: number;
};

const DEMO_SESSIONS: Session[] = [
  {
    key: "demo-1",
    snapshotDate: "2026-06-19",
    diffCount: 2,
    rows: [
      { id: -1, product_id: 1, counted_qty: 42, snapshot_date: "2026-06-19", note: "盤點差異：帳上 44 → 實際 42（-2）", created_at: "2026-06-19T02:00:00Z" },
      { id: -2, product_id: 3, counted_qty: 35, snapshot_date: "2026-06-19", note: "盤點：與帳上一致", created_at: "2026-06-19T02:00:00Z" },
      { id: -3, product_id: 7, counted_qty: 8, snapshot_date: "2026-06-19", note: "盤點差異：帳上 5 → 實際 8（+3）", created_at: "2026-06-19T02:00:00Z" },
    ],
  },
];
const DEMO_PRODUCT_MAP: Record<number, ProductLite> = {
  1: { id: 1, product_name: "矽藻土杯墊", variant_name: "圓形-大理石紋" },
  3: { id: 3, product_name: "分裝瓶", variant_name: "100ml透明" },
  7: { id: 7, product_name: "矽藻土杯墊", variant_name: "方形-素色白" },
};

function groupSessions(rows: SnapshotRow[]): Session[] {
  const map = new Map<string, SnapshotRow[]>();
  for (const r of rows) {
    const key = r.created_at;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const sessions: Session[] = [];
  for (const [key, sessionRows] of map) {
    sessions.push({
      key,
      snapshotDate: sessionRows[0].snapshot_date,
      rows: sessionRows,
      diffCount: sessionRows.filter((r) => r.note && !r.note.includes("一致")).length,
    });
  }
  return sessions.sort((a, b) => (a.key < b.key ? 1 : -1));
}

export function StocktakeRecords() {
  const { isDemo } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [products, setProducts] = useState<Record<number, ProductLite>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      if (isDemo) {
        setSessions(DEMO_SESSIONS);
        setProducts(DEMO_PRODUCT_MAP);
        return;
      }
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("stock_snapshots")
        .select("id, product_id, counted_qty, snapshot_date, note, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const rows = data || [];
      const grouped = groupSessions(rows);
      setSessions(grouped);

      const productIds = [...new Set(rows.map((r) => r.product_id))];
      if (productIds.length > 0) {
        const { data: prods } = await supabase.from("products").select("id, product_name, variant_name").in("id", productIds);
        const map: Record<number, ProductLite> = {};
        (prods || []).forEach((p) => {
          map[p.id] = p;
        });
        setProducts(map);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "載入失敗", "error");
    } finally {
      setLoading(false);
    }
  }, [isDemo, toast]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  return (
    <div className="min-h-screen bg-white">
      {isDemo && (
        <div className="bg-[#F5A623] text-[#171717] text-xs text-center py-1 font-medium">展示模式 — 資料為模擬</div>
      )}

      <header className="px-5 pt-6 pb-3 max-w-2xl mx-auto">
        <a href="/stock" className="inline-flex items-center gap-1 text-sm text-[#8F8F8F] hover:text-[#171717] transition-colors duration-150 mb-2">
          ‹ 返回庫存
        </a>
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">盤點紀錄</h1>
        <p className="text-sm text-[#8F8F8F] mt-0.5">共 {sessions.length} 次盤點</p>
      </header>

      <main className="px-5 max-w-2xl mx-auto pb-10">
        {loading ? (
          <div className="text-center py-16 text-[#8F8F8F] text-sm">載入中...</div>
        ) : sessions.length === 0 ? (
          <div className="rounded-2xl border border-[#EAEAEA] p-8 text-center">
            <p className="text-sm text-[#8F8F8F]">還沒有盤點紀錄</p>
            <a href="/stock?stocktake=1" className="text-[#0070F3] text-sm underline mt-2 inline-block">開始第一次盤點</a>
          </div>
        ) : (
          <div className="space-y-2 app-fade-up-enter">
            {sessions.map((session) => {
              const isOpen = expanded === session.key;
              return (
                <div key={session.key} className="rounded-2xl border border-[#EAEAEA] overflow-hidden">
                  <button
                    onClick={() => setExpanded(isOpen ? null : session.key)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-[#FAFAFA] transition-colors duration-150"
                  >
                    <div>
                      <p className="text-sm font-medium text-[#171717]">{session.snapshotDate}</p>
                      <p className="text-xs text-[#8F8F8F] mt-0.5">
                        共 {session.rows.length} 項
                        {session.diffCount > 0 ? `，${session.diffCount} 項有差異` : "，全數與帳上一致"}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${
                        session.diffCount > 0
                          ? "bg-[#F5A623]/10 text-[#F5A623] border-[#F5A623]/30"
                          : "bg-[#0CCE6B]/10 text-[#0CCE6B] border-[#0CCE6B]/30"
                      }`}
                    >
                      {session.diffCount > 0 ? `${session.diffCount} 項差異` : "全數一致"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-[#EAEAEA] divide-y divide-[#EAEAEA]">
                      {session.rows.map((r) => {
                        const p = products[r.product_id];
                        const isDiff = r.note && !r.note.includes("一致");
                        return (
                          <div key={r.id} className="px-4 py-2.5">
                            <p className="text-sm text-[#171717]">
                              {p ? `${p.product_name}${p.variant_name ? `（${p.variant_name}）` : ""}` : `商品 #${r.product_id}`}
                            </p>
                            <p className={`text-xs mt-0.5 ${isDiff ? "text-[#F5A623]" : "text-[#8F8F8F]"}`}>{r.note}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
