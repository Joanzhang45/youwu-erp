"use client";

// 全站受保護頁面共用的等待層（M7，Joan 2026-07-14 二次拍板：完全移除登入體驗）。
// M6 這層原本是「未登入導去 /login」，M7 改成 AuthProvider 背景自動登入，這裡的責任
// 縮小成單純「等自動登入跑完再渲染內容」——loading 期間顯示極簡空白骨架，不閃真實頁面
// 殘影或（舊版）demo 假資料。自動登入正常情況下幾乎瞬間完成，訪客不會感覺到這一層存在。
//
// 唯一會讓訪客真的看到東西的情況：自動登入失敗（網路斷線／Supabase 服務問題等）——這時
// 顯示簡單錯誤畫面＋重試按鈕，不做無限轉圈（無限 loading 骨架會讓人以為系統當機）。
//
// 套用範圍：/today /inbound /receive /stock /catalog /sales /spend /insights /more
// 這 9 個受保護頁，各自的 page.tsx 用 <RequireAuth> 包住原本的內容元件。
// 不套用：/help（公開可看、無敏感資料）；舊 13＋1（含退場的 /login）頁 redirect stub
// （它們自己 useEffect 轉址到新頁，新頁本身已經會被這層攔，不需要疊兩層判斷）。
import { useAuth } from "@/lib/AuthContext";

function Skeleton() {
  return <div className="min-h-screen bg-white" />;
}

function AutoLoginFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-5">
      <div className="text-center max-w-xs">
        <p className="text-base font-medium text-[#171717]">連線失敗</p>
        <p className="text-sm text-[#8F8F8F] mt-1.5 leading-relaxed">
          可能是網路不穩，或系統暫時有問題。按重試看看，還是不行就跟瓊安說一聲。
        </p>
        <button
          onClick={onRetry}
          className="mt-5 px-5 py-2.5 rounded-xl bg-[#171717] text-white text-sm font-medium active:scale-[0.97] transition-transform duration-150"
        >
          重試
        </button>
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading, authError, retryAutoLogin } = useAuth();

  if (!loading && !session && authError) {
    return <AutoLoginFailed onRetry={retryAutoLogin} />;
  }

  if (loading || !session) {
    return <Skeleton />;
  }

  return <>{children}</>;
}
