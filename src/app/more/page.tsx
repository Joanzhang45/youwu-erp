"use client";

// 「更多」過渡選單頁（任務①）。目的：把新舊兩代頁面接成「同一個 app 還沒翻新完的房間」，
// 不是把使用者丟回舊首頁（8 卡片＋5 tab 那套，S1 兩套導覽並存的病灶）。
// 分析已經是新版（/insights），其餘五項暫連舊路由，右側標「改版中」小徽章降低違和感。
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { signOutUser } from "@/lib/supabase";
import {
  InsightsIcon,
  BoxIcon,
  ClipboardIcon,
  WalletIcon,
  TruckIcon,
  LogoutIcon,
  ChevronRightIcon,
} from "@/components/app/icons";
import type { ComponentType } from "react";

type Entry = {
  href: string;
  label: string;
  desc: string;
  Icon: ComponentType<{ className?: string }>;
  legacy: boolean;
};

const primary: Entry[] = [
  { href: "/insights", label: "分析", desc: "本月損益、商品排行", Icon: InsightsIcon, legacy: false },
  { href: "/products", label: "商品", desc: "商品主檔、成本", Icon: BoxIcon, legacy: true },
  { href: "/orders", label: "訂單", desc: "銷售訂單、CSV 匯入", Icon: ClipboardIcon, legacy: true },
  { href: "/expenses", label: "費用", desc: "廣告、營業費用", Icon: WalletIcon, legacy: true },
];

const purchasing: Entry[] = [
  { href: "/purchase", label: "採購", desc: "採購單列表", Icon: TruckIcon, legacy: true },
  { href: "/purchase/shipments", label: "集運", desc: "集運費用統計", Icon: TruckIcon, legacy: true },
  { href: "/logistics", label: "物流", desc: "境內物流追蹤", Icon: TruckIcon, legacy: true },
  { href: "/selections", label: "選品", desc: "選品評估", Icon: TruckIcon, legacy: true },
];

function LegacyBadge() {
  return (
    <span className="text-[10px] text-[#8F8F8F] bg-[#FAFAFA] border border-[#EAEAEA] px-1.5 py-0.5 rounded-full flex-shrink-0">
      改版中
    </span>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  return (
    <Link
      href={entry.href}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-[#FAFAFA] transition-colors duration-150"
    >
      <div className="w-9 h-9 rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] flex items-center justify-center flex-shrink-0 text-[#171717]">
        <entry.Icon className="w-[18px] h-[18px]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#171717]">{entry.label}</p>
        <p className="text-xs text-[#8F8F8F] truncate">{entry.desc}</p>
      </div>
      {entry.legacy && <LegacyBadge />}
      <ChevronRightIcon className="w-4 h-4 text-[#8F8F8F] flex-shrink-0" />
    </Link>
  );
}

export default function MorePage() {
  const { session, isDemo, loading } = useAuth();

  return (
    <div className="min-h-screen bg-white">
      {isDemo && (
        <div className="bg-[#F5A623] text-[#171717] text-xs text-center py-1 font-medium">
          展示模式 — 資料為模擬
        </div>
      )}

      <header className="px-5 pt-6 pb-4 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">更多</h1>
      </header>

      <main className="px-5 max-w-2xl mx-auto pb-10">
        <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden mb-5">
          {primary.map((e) => (
            <EntryRow key={e.href} entry={e} />
          ))}
        </div>

        <p className="text-xs font-medium text-[#8F8F8F] mb-2 px-1">進貨相關</p>
        <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden mb-5">
          {purchasing.map((e) => (
            <EntryRow key={e.href} entry={e} />
          ))}
        </div>

        <div className="rounded-2xl border border-[#EAEAEA] overflow-hidden">
          {!loading && (
            <>
              {isDemo ? (
                <Link
                  href="/login"
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-[#FAFAFA] transition-colors duration-150"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] flex items-center justify-center flex-shrink-0 text-[#171717]">
                    <LogoutIcon className="w-[18px] h-[18px]" />
                  </div>
                  <p className="text-sm font-medium text-[#0070F3]">登入</p>
                </Link>
              ) : (
                <button
                  onClick={() => signOutUser()}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[#FAFAFA] transition-colors duration-150 text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] flex items-center justify-center flex-shrink-0 text-[#171717]">
                    <LogoutIcon className="w-[18px] h-[18px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#171717]">登出</p>
                    <p className="text-xs text-[#8F8F8F] truncate">{session?.user.email}</p>
                  </div>
                </button>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
