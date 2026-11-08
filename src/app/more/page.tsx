"use client";

// 「更多」頁（M5 定版；M7 拿掉登出）。舊 13 頁已全數退場為 redirect stub，這裡不再是
// 「新舊接房間」的過渡選單，而是手機「更多」tab 的正式目的地：分析／商品／訂單／費用——
// 4 個桌機有獨立頂部節點、但手機 4 個 bottom tab 放不下的頁面，收在這裡＋使用說明。
// 「進貨」「庫存」「今天」在手機已有自己的 bottom tab，不再重複列在這裡。
// 2026-10-21 改回正常登入後，第二次健檢 #22 把登出加回來：「登出這台」只清這台裝置，
// 「登出所有裝置」讓這個帳號在每台手機電腦上的登入一起失效（手機掉了時用）。
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { signOutUser } from "@/lib/supabase";
import { staffNames } from "@/lib/staff";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { friendlyError } from "@/lib/friendlyError";
import { RequireAuth } from "@/components/app/RequireAuth";
import {
  InsightsIcon,
  BoxIcon,
  ClipboardIcon,
  WalletIcon,
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

// 使用說明入口（獨立一組——它不是「四個桌機節點手機收合」的那一類，是給彣錩看的
// 操作手冊，跟上面四個資料頁刻意分開一組視覺上更清楚）。
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
        <p className="text-xs text-[#6B6B6B] truncate">{entry.desc}</p>
      </div>
      <ChevronRightIcon className="w-4 h-4 text-[#6B6B6B] flex-shrink-0" />
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

        <AccountSection />
      </main>
    </div>
  );
}

function AccountSection() {
  const { session } = useAuth();
  const router = useRouter();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const uid = session?.user.id;

  useEffect(() => {
    if (!uid) return;
    staffNames().then((m) => setName(m.get(uid) ?? ""));
  }, [uid]);

  const logout = async (scope: "local" | "global") => {
    const ok = await confirm(
      scope === "local"
        ? { title: "登出這台裝置？", message: "下次打開要重新輸入帳號密碼。", confirmText: "登出" }
        : {
            title: "登出所有裝置？",
            message: "這個帳號在每一台手機、電腦上都會被登出，包含這台。手機遺失時用這個。",
            confirmText: "全部登出",
            danger: true,
          },
    );
    if (!ok) return;
    setBusy(true);
    const { error } = await signOutUser(scope);
    if (error) {
      toast(friendlyError(error, "登出失敗"), "error");
      setBusy(false);
      return;
    }
    router.replace("/login");
  };

  return (
    <div className="rounded-2xl border border-[#EAEAEA] p-4">
      <p className="text-sm text-[#171717]">
        目前登入：<span className="font-medium">{name || session?.user.email || "—"}</span>
      </p>
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => logout("local")}
          disabled={busy}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-[#EAEAEA] text-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-50"
        >
          登出這台
        </button>
        <button
          onClick={() => logout("global")}
          disabled={busy}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-red-200 text-red-600 active:scale-[0.98] transition-transform duration-150 disabled:opacity-50"
        >
          登出所有裝置
        </button>
      </div>
    </div>
  );
}
