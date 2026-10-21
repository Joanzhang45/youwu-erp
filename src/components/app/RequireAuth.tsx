"use client";

// 全站受保護頁面共用的守門層（2026-10-21 改回正常登入，取代 M7 的背景自動登入）：
// session 還在讀取時顯示空白骨架（不閃真實頁面）；確認未登入就導到 /login?next=<原頁>，
// 登入後由 /login 導回。套用範圍：/today /inbound /receive /stock /catalog /sales /spend
// /insights /more，各頁 page.tsx 用 <RequireAuth> 包住內容。不套用：/help（公開靜態頁）。
// static export 不能用動態路由，原頁路徑與原有 query 一律以 query param（next）帶。
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

function Skeleton() {
  return <div className="min-h-screen bg-white" />;
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || session) return;
    const search = typeof window !== "undefined" ? window.location.search : "";
    router.replace(`/login?next=${encodeURIComponent(pathname + search)}`);
  }, [loading, session, pathname, router]);

  if (loading || !session) return <Skeleton />;
  return <>{children}</>;
}
