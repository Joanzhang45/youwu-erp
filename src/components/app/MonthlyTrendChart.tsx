"use client";

// 近 6 個月營收／淨利趨勢（PRD §5、任務②）。手刻 SVG，不引入 chart 套件（repo 目前
// 零 chart 依賴，符合任務鐵律「不引入大型 chart 套件」）。
// 視覺：每月一組「疊層柱」——淺灰底柱＝營收，深色窄柱置中疊在上面＝淨利，
// 一眼看出「淨利佔營收多少」，比並排雙柱在 375px 寬度下更省版面。
import type { MonthlyProfitability } from "@/lib/database.types";

const CHART_HEIGHT = 120;
const CHART_WIDTH = 320;
const BAR_MAX_H = 92;

function formatCompact(n: number): string {
  // view 的金額欄位是浮點數（numeric 除法算出來），先四捨五入再格式化，
  // 不然 .toLocaleString() 預設留 3 位小數會噴出「$7,696.588」這種雜訊
  // （2026-07-12 自測用真實登入態截圖抓到，同一顆 bug 也修在 /insights headline 卡）
  const sign = n < 0 ? "-" : "";
  const abs = Math.round(Math.abs(n));
  if (abs >= 10000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toLocaleString()}`;
}

export function MonthlyTrendChart({ data }: { data: MonthlyProfitability[] }) {
  if (data.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-[#8F8F8F]">尚無月度資料</div>
    );
  }

  // 資料查詢統一 month DESC（最新在前），畫圖要由舊到新（左到右）
  const chrono = [...data].reverse();
  const maxVal = Math.max(1, ...chrono.map((m) => Number(m.total_net_revenue) || 0));
  const groupW = CHART_WIDTH / chrono.length;
  const barW = Math.min(30, groupW * 0.42);

  return (
    <div>
      <div className="flex items-center gap-4 mb-3">
        <span className="flex items-center gap-1.5 text-[11px] text-[#8F8F8F]">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#EAEAEA] inline-block" />
          營收
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-[#8F8F8F]">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#171717] inline-block" />
          淨利
        </span>
      </div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-auto" role="img" aria-label="近六個月營收與淨利趨勢">
        {chrono.map((m, i) => {
          const revenue = Number(m.total_net_revenue) || 0;
          const profit = Number(m.net_profit) || 0;
          const revH = Math.max(2, (revenue / maxVal) * BAR_MAX_H);
          const profitH = Math.max(2, (Math.abs(profit) / maxVal) * BAR_MAX_H);
          const cx = groupW * i + groupW / 2;
          const baseY = BAR_MAX_H + 4;
          const monthNum = Number(m.month.slice(5, 7));
          const isNegative = profit < 0;

          return (
            <g key={m.month}>
              {/* 營收底柱 */}
              <rect
                x={cx - barW / 2}
                y={baseY - revH}
                width={barW}
                height={revH}
                rx={4}
                className="fill-[#EAEAEA]"
              />
              {/* 淨利疊柱（負值畫在基線之上、用紅色標示虧損月） */}
              <rect
                x={cx - barW / 2.6}
                y={isNegative ? baseY : baseY - profitH}
                width={barW / 1.3}
                height={profitH}
                rx={3}
                className={isNegative ? "fill-[#E00]" : "fill-[#171717]"}
              />
              <text
                x={cx}
                y={baseY - revH - 6 < 10 ? 10 : baseY - revH - 6}
                textAnchor="middle"
                className="fill-[#171717] text-[9px] font-medium"
              >
                {formatCompact(profit)}
              </text>
              <text x={cx} y={CHART_HEIGHT - 4} textAnchor="middle" className="fill-[#8F8F8F] text-[10px]">
                {monthNum}月
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
