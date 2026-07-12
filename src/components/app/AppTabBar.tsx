"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TodayIcon, ReceiveIcon, StockIcon, MoreIcon } from "./icons";

const tabs = [
  { href: "/today", label: "今天", Icon: TodayIcon, match: "/today" },
  { href: "/receive", label: "點收", Icon: ReceiveIcon, match: "/receive" },
  { href: "/stock", label: "庫存", Icon: StockIcon, match: "/stock" },
  { href: "/more", label: "更多", Icon: MoreIcon, match: "/more" },
] as const;

// 「更多」頁是過渡選單頁，「分析」「進貨」「商品」「訂單」「費用」暫時掛在它底下
// （PRD §3 完整 7 節點側欄留待 M5），所以走這些新路由時底部導覽也要點亮「更多」，
// 不然會看起來像離開了 app（M4 第三批追加 /catalog /sales /spend）。
const MORE_UMBRELLA = ["/more", "/insights", "/inbound", "/catalog", "/sales", "/spend"];

export function AppTabBar() {
  const pathname = usePathname();
  const cleanPath = pathname.replace(/^\/youwu-erp/, "") || "/";

  const isActive = (match: string) => {
    if (match === "/more") return MORE_UMBRELLA.some((p) => cleanPath === p || cleanPath.startsWith(p + "?"));
    return cleanPath === match || cleanPath.startsWith(match + "?");
  };

  return (
    <>
      {/* 手機：底部 tab */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#EAEAEA] safe-bottom"
        aria-label="主要導覽"
      >
        <div className="flex items-stretch justify-around max-w-lg mx-auto">
          {tabs.map((tab) => {
            const active = isActive(tab.match);
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

      {/* 桌機：頂部細 nav（M2 範圍只做 4 個節點，完整 7 節點側欄留待 M4/M5） */}
      <nav
        className="hidden sm:flex fixed top-0 left-0 right-0 z-50 h-14 bg-white/90 backdrop-blur border-b border-[#EAEAEA] items-center px-6"
        aria-label="主要導覽"
      >
        <span className="text-sm font-semibold text-[#171717] tracking-tight mr-8">
          有物 ERP
        </span>
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const active = isActive(tab.match);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors duration-150 ${
                  active
                    ? "text-[#171717] font-medium bg-[#FAFAFA]"
                    : "text-[#8F8F8F] hover:text-[#171717]"
                }`}
              >
                <tab.Icon className="w-4 h-4" />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
