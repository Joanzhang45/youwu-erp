"use client";

// 底部彈出表單的共用外框與欄位（沿用 StockAdjustSheet 的 Geist 視覺）。
// 第二次健檢 #20：全站彈出表單都走這個外框——
//   - × 按鈕 40px、可按 Esc 關；
//   - 表單裡打過字（或呼叫端傳 dirty）就先問「要丟掉嗎」，不會一按就把填到一半的內容丟掉；
//   - 點背景不關閉：手機上誤觸會把填到一半的表單整個丟掉。
// 沒有 title 時不畫標題列，呼叫端自己用 <SheetCloseButton /> 放關閉鈕（例：新增採購單有多個階段標題）。
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { friendlyError, messageOf } from "@/lib/friendlyError";

const SheetCloseContext = createContext<() => void>(() => {});

// 目前開著的表單，Esc 只關最上面那一個
const openSheets: number[] = [];
let sheetSeq = 0;

export function Sheet({
  title,
  onClose,
  dirty,
  children,
}: {
  title?: string;
  onClose: () => void;
  dirty?: boolean;
  children: ReactNode;
}) {
  const { confirm } = useConfirm();
  const [typed, setTyped] = useState(false);
  const asking = useRef(false);
  const id = useRef(0);

  const requestClose = useCallback(async () => {
    if (asking.current) return;
    if (dirty || typed) {
      asking.current = true;
      const ok = await confirm({
        title: "要丟掉填到一半的內容嗎？",
        message: "關掉之後，剛剛填的資料不會存。",
        confirmText: "丟掉",
        cancelText: "繼續填",
        danger: true,
      });
      asking.current = false;
      if (!ok) return;
    }
    onClose();
  }, [confirm, dirty, typed, onClose]);

  useEffect(() => {
    id.current = ++sheetSeq;
    openSheets.push(id.current);
    return () => {
      const i = openSheets.indexOf(id.current);
      if (i >= 0) openSheets.splice(i, 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || openSheets[openSheets.length - 1] !== id.current) return;
      e.preventDefault();
      requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  return (
    <SheetCloseContext.Provider value={requestClose}>
      <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onInput={() => setTyped(true)}
          className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl border border-[#EAEAEA] p-5 app-sheet-enter"
        >
          {title !== undefined && (
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#171717]">{title}</h2>
              <SheetCloseButton />
            </div>
          )}
          {children}
        </div>
      </div>
    </SheetCloseContext.Provider>
  );
}

export function SheetCloseButton() {
  const requestClose = useContext(SheetCloseContext);
  return (
    <button
      type="button"
      onClick={requestClose}
      className="-mr-1 w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full bg-[#FAFAFA] text-2xl leading-none text-[#444444] hover:bg-[#EAEAEA] transition-colors duration-150"
      aria-label="關閉"
    >
      &times;
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-medium text-[#171717] mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-[#6B6B6B] mt-1">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full px-3 py-2.5 text-sm border border-[#EAEAEA] rounded-lg outline-none focus:border-[#171717] focus:ring-2 focus:ring-[#0070F3]/30";

export function SubmitButton({ busy, children, onClick }: { busy: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="w-full py-3.5 rounded-xl text-white font-semibold text-base bg-[#171717] active:scale-[0.98] transition-transform duration-150 disabled:opacity-50"
    >
      {busy ? "處理中..." : children}
    </button>
  );
}

// map：這個畫面專用的代號說法，優先於 friendlyError 的通用翻譯
export function errorText(e: unknown, map: Record<string, string> = {}): string {
  const msg = messageOf(e);
  for (const [code, text] of Object.entries(map)) if (msg.includes(code)) return text;
  return friendlyError(e);
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
