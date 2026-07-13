"use client";

// 「更多」頁（M5 定版）。舊 13 頁已全數退場為 redirect stub，這裡不再是「新舊接房間」的
// 過渡選單，而是手機「更多」tab 的正式目的地：分析／商品／訂單／費用——4 個桌機有獨立
// 頂部節點、但手機 4 個 bottom tab 放不下的頁面，收在這裡＋登出。
// 「進貨」「庫存」「今天」在手機已有自己的 bottom tab，不再重複列在這裡。
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { signOutUser } from "@/lib/supabase";
import { RequireAuth } from "@/components/app/RequireAuth";
import {
  InsightsIcon,
  BoxIcon,
  ClipboardIcon,
  WalletIcon,
  LogoutIcon,
  ChevronRightIcon,
  HelpIcon,
} from "@/components/app/icons";
import type { ComponentType } from "react";

type Entry = {
  href: string;
  label: string;
  desc: string;
  Icon: ComponentType<{ className?: string }>;
};

const primary: Entry[] = [
  { href: "/insights", label: "分析", desc: "本月損益、商品排行", Icon: InsightsIcon },
  { href: "/catalog", label: "商品", desc: "商品主檔、蝦皮對應", Icon: BoxIcon },
  { href: "/sales", label: "訂單", desc: "銷售訂單、CSV 匯入", Icon: ClipboardIcon },
  { href: "/spend", label: "費用", desc: "廣告、營業費用", Icon: WalletIcon },
];

// 使用說明入口（放登出上方，獨立一組——它不是「四個桌機節點手機收合」的那一類，
// 是給彣錩看的操作手冊，跟上面四個資料頁刻意分開一組視覺上更清楚）。
const helpEntry: Entry = { href: "/help", label: "使用說明", desc: "操作步驟、常見問題", Icon: HelpIcon };

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
      <ChevronRightIcon className="w-4 h-4 text-[#8F8F8F] flex-shrink-0" />
    </Link>
  );
}

export default function MorePage() {
  return (
    <RequireAuth>
      <MorePageContent />
    </RequireAuth>
  );
}

function MorePageContent() {
  // 這頁被 RequireAuth 擋在外層，能渲染到這裡代表 session 一定存在（未登入已被導去 /login），
  // 不再需要 isDemo/loading 分支判斷「登入」還是「登出」——一律是登出。
  const { session } = useAuth();

  return (
    <div className="min-h-screen bg-white">
      <header className="px-5 pt-6 pb-4 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">更多</h1>
      </header>

      <main className="px-5 max-w-2xl mx-auto pb-10">
        <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden mb-5">
          {primary.map((e) => (
            <EntryRow key={e.href} entry={e} />
          ))}
        </div>

        <div className="rounded-2xl border border-[#EAEAEA] overflow-hidden mb-5">
          <EntryRow entry={helpEntry} />
        </div>

        <div className="rounded-2xl border border-[#EAEAEA] overflow-hidden">
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
        </div>
      </main>
    </div>
  );
}
