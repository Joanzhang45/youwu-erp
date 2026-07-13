"use client";

// 全站受保護頁面共用的登入牆（M6，Joan 2026-07-14 拍板：全站移除 demo 假資料模式）。
// 背景：彣錩未登入開站看到假數字，直接懷疑「系統壞掉／設計不良」——先讓訪客看假資料對真實
// 使用者是反效果，改成未登入一律攔在 /login 前，loading 判定期間顯示極簡空白骨架，
// 絕不閃真實頁面的殘影或假資料。
//
// 套用範圍：/today /inbound /receive /stock /catalog /sales /spend /insights /more
// 這 9 個受保護頁，各自的 page.tsx 用 <RequireAuth> 包住原本的內容元件。
// 不套用：/help（公開可看、無敏感資料）；舊 13 頁 redirect stub（它們自己 useEffect
// 轉址到新頁，新頁本身已經會被這層攔，不需要疊兩層判斷，見各 RedirectStub 呼叫點）。
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/login");
    }
  }, [loading, session, router]);

  // loading 中或確定未登入（即將被上面的 effect 導去 /login）都只給極簡空白骨架，
  // 不渲染任何子內容——避免真實頁面殘影或（舊版）demo 假資料在轉址前先閃一下。
  if (loading || !session) {
    return <div className="min-h-screen bg-white" />;
  }

  return <>{children}</>;
}
