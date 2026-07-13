"use client";

// 使用說明頁（/help，站內操作手冊）。寫給彣錩：非技術、用手機、常在收貨現場/貨架前操作，
// 第一次看新版反映「光是進貨就找不到按哪裡」——這頁就是為他寫的白話說明書。
//
// 純靜態頁面，不打 Supabase、不驗證登入態。M7（2026-07-14 二次拍板）全站移除登入體驗後，
// 整個「登入／未登入」的區分已經不存在——AuthProvider 背景自動登入，訪客感覺不到這件事，
// 這頁也就不用再處理「未登入看得到嗎」的問題（改版前那句顧慮已經過時）。維持不用 useAuth、
// 不需要 "use client" 以外任何 hook 的原因單純是這頁本來就是純靜態內容。
//
// 每節用原生 <details>/<summary>（Tailwind v4 group-open: 變體驅動展開圖示旋轉），
// 不用 useState 手刻 accordion：語意正確、鍵盤可操作、免 JS 也能展開，最適合這種
// 純內容頁。第 0、1 節（認識四顆按鈕／進貨在哪）預設展開，其餘節點收合。
import Link from "next/link";
import type { ReactNode } from "react";
import {
  TodayIcon,
  TimelineIcon,
  StockIcon,
  MoreIcon,
  ChevronRightIcon,
} from "@/components/app/icons";

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-2xl border border-[#EAEAEA] bg-white overflow-hidden"
    >
      <summary className="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <span className="text-xl font-semibold text-[#171717] tracking-tight">{title}</span>
        <ChevronRightIcon className="w-5 h-5 text-[#8F8F8F] flex-shrink-0 transition-transform duration-200 group-open:rotate-90" />
      </summary>
      <div className="px-5 pb-5 pt-1 border-t border-[#EAEAEA] space-y-4">{children}</div>
    </details>
  );
}

function StepCard({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex gap-3.5 items-start">
      <div className="w-9 h-9 rounded-full bg-[#171717] text-white flex items-center justify-center flex-shrink-0 text-base font-semibold tabular-nums">
        {n}
      </div>
      <div className="text-lg text-[#171717] leading-relaxed pt-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}

function NoteBox({ children }: { children: ReactNode }) {
  return (
    <p className="text-base text-[#8F8F8F] leading-relaxed rounded-xl bg-[#FAFAFA] px-4 py-3">
      {children}
    </p>
  );
}

function FAQItem({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-lg font-semibold text-[#171717]">{q}</p>
      <p className="text-base text-[#171717] leading-relaxed mt-1">{children}</p>
    </div>
  );
}

const TAB_INTRO = [
  { Icon: TodayIcon, label: "今天", desc: "開 app 先看這裡，有事它會叫你" },
  { Icon: TimelineIcon, label: "進貨", desc: "叫的貨走到哪了、到了按這裡點收" },
  { Icon: StockIcon, label: "庫存", desc: "查數量、加減庫存、盤點" },
  { Icon: MoreIcon, label: "更多", desc: "商品、訂單、費用、分析都收在這" },
] as const;

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="px-5 pt-6 pb-2 max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold text-[#171717] tracking-tight">使用說明</h1>
        <p className="text-lg text-[#8F8F8F] mt-2 leading-relaxed">
          這一頁教你怎麼用。找不到東西就回來看這頁，或直接問瓊安。
        </p>
      </header>

      <main className="px-5 max-w-2xl mx-auto pb-10 pt-4 space-y-3 app-fade-up-enter">
        {/* 第 0 節：先認識底部四顆按鈕 */}
        <Section title="先認識下面四顆按鈕" defaultOpen>
          <p className="text-base text-[#8F8F8F]">手機打開 app，最下面固定有四顆，先記這四顆就好。</p>
          <div className="rounded-2xl border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
            {TAB_INTRO.map(({ Icon, label, desc }) => (
              <div key={label} className="flex items-center gap-4 px-4 py-3.5">
                <div className="w-11 h-11 rounded-xl bg-[#FAFAFA] border border-[#EAEAEA] flex items-center justify-center flex-shrink-0 text-[#171717]">
                  <Icon className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-[#171717]">{label}</p>
                  <p className="text-base text-[#8F8F8F] mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* 第 1 節：進貨的東西在哪（彣錩的痛點，放最前面） */}
        <Section title="進貨的東西在哪" defaultOpen>
          <p className="text-base text-[#8F8F8F]">這是彣錩最卡的地方，先看這個。</p>
          <div className="space-y-4">
            <StepCard n={1}>點下面第二顆「進貨」。</StepCard>
            <StepCard n={2}>
              看到一張張卡片，一張卡＝一筆叫貨，上面有進度：下單 → 寄出 → 集運 → 到貨 → 入庫。
            </StepCard>
            <StepCard n={3}>點卡片進去，會看到一條時間線，走到哪一站一目了然。</StepCard>
            <StepCard n={4}>該做下一步時，按鈕就在那一站上面，例如「貨到台灣了」，按下去就好。</StepCard>
          </div>
          <NoteBox>以前的選品、採購、集運、物流四頁，現在全部合在這一頁。</NoteBox>
        </Section>

        {/* 第 2 節：貨到了怎麼點收 */}
        <Section title="貨到了怎麼點收">
          <div className="space-y-4">
            <StepCard n={1}>貨到那天打開 app，「今天」會有一張卡片寫「已到貨，待點收」。</StepCard>
            <StepCard n={2}>點進去，一次數一樣商品：有圖有名字，數完輸入數量。</StepCard>
            <StepCard n={3}>全部數完，按「完成點收」，庫存自動加好。</StepCard>
          </div>
          <NoteBox>數到一半有事走開沒關係，回來會從斷掉的地方繼續。</NoteBox>
        </Section>

        {/* 第 3 節：庫存怎麼查、怎麼改 */}
        <Section title="庫存怎麼查、怎麼改">
          <div className="space-y-4">
            <StepCard n={1}>點下面第三顆「庫存」，上面有搜尋，打商品名字。</StepCard>
            <StepCard n={2}>
              <p>卡片右邊有兩顆按鈕可以按：</p>
              <div className="flex items-center gap-5 mt-2">
                <span className="inline-flex items-center gap-2 text-base text-[#171717]">
                  <span className="w-8 h-8 rounded-lg bg-[#0CCE6B]/10 text-[#0CCE6B] font-bold flex items-center justify-center flex-shrink-0">
                    ＋
                  </span>
                  入庫
                </span>
                <span className="inline-flex items-center gap-2 text-base text-[#171717]">
                  <span className="w-8 h-8 rounded-lg bg-[#0070F3]/10 text-[#0070F3] font-bold flex items-center justify-center flex-shrink-0">
                    −
                  </span>
                  出庫
                </span>
              </div>
            </StepCard>
            <StepCard n={3}>按下去，輸入數字，按確認就好。</StepCard>
          </div>
        </Section>

        {/* 第 4 節：盤點怎麼盤 */}
        <Section title="盤點怎麼盤">
          <div className="space-y-4">
            <StepCard n={1}>「庫存」頁上面有「開始盤點」，點下去。</StepCard>
            <StepCard n={2}>選一區（一個分類），開始一樣一樣數。</StepCard>
            <StepCard n={3}>每樣東西輸入你實際數到的數量。</StepCard>
            <StepCard n={4}>數字跟帳上不一樣會變色，不用緊張，這就是盤點要抓的東西。</StepCard>
            <StepCard n={5}>全部數完按「完成盤點」，帳自動改好，這次盤點的紀錄之後都查得到。</StepCard>
          </div>
        </Section>

        {/* 第 5 節：常見問題 */}
        <Section title="常見問題">
          <div className="space-y-5">
            <FAQItem q="換新手機？">
              直接開網址就能用，不用設定、不用登入，跟原本那支手機看到的一樣。
            </FAQItem>
            <FAQItem q="我記得以前有一頁 OO，怎麼不見了？">
              沒有不見，是搬家了。開舊的網址會自動帶你到新的地方。
            </FAQItem>
            <FAQItem q="按錯了怎麼辦？">
              大部分動作都有紀錄可以查，跟瓊安說一聲就能改回來，不會爆炸。
            </FAQItem>
            <FAQItem q="還是找不到？">直接截圖傳給瓊安。</FAQItem>
          </div>
        </Section>

        <p className="text-sm text-[#8F8F8F] text-center pt-3">
          這頁會跟著系統更新。最後更新：2026-07-14
        </p>

        <p className="text-center pt-1">
          <Link href="/today" className="text-sm text-[#0070F3] hover:underline">
            ← 回今天
          </Link>
        </p>
      </main>
    </div>
  );
}
