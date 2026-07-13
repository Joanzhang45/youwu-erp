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
// 同批移除舊版 AuthStatusBar（bg-slate-900 深色狀態列）：登入／登出已收進新版 AppTabBar
// （桌機右側帳號區）與 /more（手機），留著會在桌機頂部疊出多一條列、視覺語言也跟 Geist
// 白底不搭。
// M6（2026-07-14）：demo 假資料模式全站移除，9 個受保護頁改用 RequireAuth 擋未登入訪客
// （見 src/components/app/RequireAuth.tsx），不再需要各頁自己判斷 isDemo 顯示黃色橫幅。

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
