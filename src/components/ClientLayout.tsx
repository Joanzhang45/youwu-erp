"use client";

import { usePathname } from "next/navigation";
import { ToastProvider } from "./Toast";
import { ConfirmProvider } from "./ConfirmDialog";
import { TabBar } from "./TabBar";
import { AuthProvider } from "@/lib/AuthContext";
import { AuthStatusBar } from "./AuthStatusBar";
import { AppTabBar } from "./app/AppTabBar";
import { GeistSans } from "@/lib/fonts";

// M2 新路由（今天／點收／庫存）與舊 13 頁共用同一個 app/layout.tsx（Next.js 只能有一個
// root layout），所以底部導覽在這裡依路徑分流，而不是動舊的 TabBar.tsx／舊頁面檔案。
// 舊路徑那一支完全對照改版前的輸出，零視覺變動；新路徑那一支才套新版 AppTabBar + Geist 字體。
// M4 第一批追加 /more（過渡選單頁）／/insights（新版分析頁）；
// M4 第二批追加 /inbound（進貨鏈時間軸，取代 selections/purchase/shipments/logistics 五頁）。
// 全部是全新檔案，同樣不動舊 13 頁。
const NEW_APP_ROUTES = ["/today", "/receive", "/stock", "/more", "/insights", "/inbound"];

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const cleanPath = pathname.replace(/^\/youwu-erp/, "") || "/";
  const isNewApp = NEW_APP_ROUTES.some((route) => cleanPath === route || cleanPath.startsWith(`${route}/`));

  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthStatusBar />
          {isNewApp ? (
            <div className={GeistSans.className}>
              <div className="pb-20 pt-0 sm:pt-14">{children}</div>
              <AppTabBar />
            </div>
          ) : (
            <>
              <div className="pb-16">{children}</div>
              <TabBar />
            </>
          )}
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
