"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { signOutUser } from "@/lib/supabase";
import { TodayIcon, StockIcon, MoreIcon, TimelineIcon, BoxIcon, ClipboardIcon, WalletIcon, InsightsIcon, LogoutIcon } from "./icons";

// M5：正式導覽（PRD §3 拍板），舊 13 頁全數退場為 redirect stub，全站只剩這一套導覽。
// 手機底部 4 tab：今天／進貨／庫存／更多。
// 「點收」（/receive）不再是一級 tab——它是「今天」任務卡／「進貨」時間軸點進去做的動作，
// 不是使用者主動想去逛的地方；保留 tab 會多一個「入口」但沒人會平白無故點它，
// 且會把 4 個一級節點擠成 5 個、375px 更窄。/receive 直接 URL 仍可用，
// active 狀態歸在「今天」底下（人在點收，心理模型上仍是「今天的待辦」，不點亮「更多」或不亮更合理）。
const MOBILE_TABS = [
  { href: "/today", label: "今天", Icon: TodayIcon, match: "/today" },
  { href: "/inbound", label: "進貨", Icon: TimelineIcon, match: "/inbound" },
  { href: "/stock", label: "庫存", Icon: StockIcon, match: "/stock" },
  { href: "/more", label: "更多", Icon: MoreIcon, match: "/more" },
] as const;

// 「今天」傘下：/receive 是從「今天」任務卡或「進貨」時間軸點進去的點收流程，非獨立節點。
const TODAY_UMBRELLA = ["/today", "/receive"];
// 手機「更多」傘下：分析／商品／訂單／費用四個桌機才有獨立節點的頁面，手機收在「更多」裡。
const MORE_UMBRELLA = ["/more", "/insights", "/catalog", "/sales", "/spend"];

// 桌機頂部 7 節點（PRD §3：今天／進貨／庫存／商品／訂單／費用／分析）。
// PRD 原文寫「側欄」，但現況慣例（M2 起）是頂部細 nav；7 個文字節點＋圖示橫向排＋右側帳號區
// 在桌機（≥640px）寬度完全放得下，不必為了照抄 PRD 字面改側欄付版面成本，故沿用頂部 nav。
const DESKTOP_NODES = [
  { href: "/today", label: "今天", Icon: TodayIcon, match: "/today" },
  { href: "/inbound", label: "進貨", Icon: TimelineIcon, match: "/inbound" },
  { href: "/stock", label: "庫存", Icon: StockIcon, match: "/stock" },
  { href: "/catalog", label: "商品", Icon: BoxIcon, match: "/catalog" },
  { href: "/sales", label: "訂單", Icon: ClipboardIcon, match: "/sales" },
  { href: "/spend", label: "費用", Icon: WalletIcon, match: "/spend" },
  { href: "/insights", label: "分析", Icon: InsightsIcon, match: "/insights" },
] as const;

export function AppTabBar() {
  const pathname = usePathname();
  const { session, isDemo, loading } = useAuth();
  const cleanPath = pathname.replace(/^\/youwu-erp/, "") || "/";

  const isMobileActive = (match: string) => {
    if (match === "/today") return TODAY_UMBRELLA.some((p) => cleanPath === p || cleanPath.startsWith(p + "?"));
    if (match === "/more") return MORE_UMBRELLA.some((p) => cleanPath === p || cleanPath.startsWith(p + "?"));
    return cleanPath === match || cleanPath.startsWith(match + "?");
  };

  const isDesktopActive = (match: string) => {
    if (match === "/today") return TODAY_UMBRELLA.some((p) => cleanPath === p || cleanPath.startsWith(p + "?"));
    return cleanPath === match || cleanPath.startsWith(match + "?");
  };

  return (
    <>
      {/* 手機：底部 4 tab */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#EAEAEA] safe-bottom"
        aria-label="主要導覽"
      >
        <div className="flex items-stretch justify-around max-w-lg mx-auto">
          {MOBILE_TABS.map((tab) => {
            const active = isMobileActive(tab.match);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 min-w-[56px] transition-colors duration-150"
              >
                <tab.Icon
                  className={active ? "text-[#171717]" : "text-[#8F8F8F]"}
                />
                <span
                  className={`text-[11px] ${
                    active ? "text-[#171717] font-medium" : "text-[#8F8F8F]"
                  }`}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* 桌機：頂部細 nav，7 節點＋右側帳號區 */}
      <nav
        className="hidden sm:flex fixed top-0 left-0 right-0 z-50 h-14 bg-white/90 backdrop-blur border-b border-[#EAEAEA] items-center px-6"
        aria-label="主要導覽"
      >
        <span className="text-sm font-semibold text-[#171717] tracking-tight mr-8 flex-shrink-0">
          有物 ERP
        </span>
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          {DESKTOP_NODES.map((node) => {
            const active = isDesktopActive(node.match);
            return (
              <Link
                key={node.href}
                href={node.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors duration-150 ${
                  active
                    ? "text-[#171717] font-medium bg-[#FAFAFA]"
                    : "text-[#8F8F8F] hover:text-[#171717]"
                }`}
              >
                <node.Icon className="w-4 h-4" />
                {node.label}
              </Link>
            );
          })}
        </div>

        {/* 右側帳號區：登入態顯示 email＋登出；demo 態顯示登入連結。
            舊版只有手機「更多」頁能登出，桌機 7 節點直達後不再繞去 /more，這裡補一個直接入口。 */}
        <div className="flex-shrink-0 ml-4">
          {!loading && (
            <>
              {isDemo ? (
                <Link
                  href="/login"
                  className="text-sm font-medium text-[#0070F3] px-3 py-1.5 rounded-lg hover:bg-[#FAFAFA] transition-colors duration-150"
                >
                  登入
                </Link>
              ) : (
                <button
                  onClick={() => signOutUser()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[#8F8F8F] hover:text-[#171717] hover:bg-[#FAFAFA] transition-colors duration-150"
                  title={session?.user.email}
                >
                  <LogoutIcon className="w-4 h-4" />
                  <span className="max-w-[140px] truncate">{session?.user.email}</span>
                </button>
              )}
            </>
          )}
        </div>
      </nav>
    </>
  );
}
