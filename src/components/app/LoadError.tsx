"use client";

// 讀取失敗時顯示的錯誤區塊。讀不到資料一律講清楚，不顯示成「目前沒有…」——
// 空清單會讓人以為沒事，或在資料不完整的畫面上做出錯誤操作（2026-11-06 第二次健檢 #7）。
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-[#FFD6D6] bg-[#FFF5F5] p-5 text-center">
      <p className="text-sm font-medium text-[#C00]">資料沒有讀到，畫面上的內容可能不完整</p>
      <p className="text-xs text-[#8F8F8F] mt-1 break-all">{friendlyLoadError(message)}</p>
      <button onClick={onRetry} className="mt-4 px-4 py-2 rounded-lg bg-[#171717] text-white text-sm font-medium">
        重新讀取
      </button>
    </div>
  );
}

export function friendlyLoadError(message: string): string {
  if (/failed to fetch|network|load failed/i.test(message)) return "網路連不上，請確認手機有網路後再試一次";
  if (/jwt|token|auth|401|permission denied/i.test(message)) return "登入可能過期了，重新整理頁面或重新登入後再試";
  return message || "原因不明";
}

export function errorMessage(e: unknown): string {
  return e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
}
