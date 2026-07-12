"use client";

import { ToastProvider } from "./Toast";
import { ConfirmProvider } from "./ConfirmDialog";
import { AuthProvider } from "@/lib/AuthContext";
import { AppTabBar } from "./app/AppTabBar";
import { GeistSans } from "@/lib/fonts";

// M5：導覽正式切新 IA，舊 13 頁全數退場為 redirect stub（見各頁 page.tsx），
// 舊 TabBar.tsx／StockModal.tsx／FilterTab.tsx 已隨舊頁一併移除，全站只剩一套
// AppTabBar + Geist 字體，不再需要依路徑分流新舊兩套佈局（M2-M4 過渡期的 NEW_APP_ROUTES
// 判斷式已隨此次切換移除）。
// 同批移除舊版 AuthStatusBar（bg-slate-900 深色狀態列）：9 個新頁各自已有 isDemo 展示模式
// 橫幅、登入／登出也已收進新版 AppTabBar（桌機右側帳號區）與 /more（手機），
// 留著會在桌機頂部疊出兩條「展示模式／登入登出」列、視覺語言也跟 Geist 白底不搭。

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <div className={GeistSans.className}>
            <div className="pb-20 pt-0 sm:pt-14">{children}</div>
            <AppTabBar />
          </div>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
