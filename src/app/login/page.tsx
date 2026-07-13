"use client";

// M7（Joan 2026-07-14 二次拍板）：全站移除登入體驗，AuthProvider 已改成背景自動登入
// （見 src/lib/AuthContext.tsx），這頁不再需要——比照舊 13 頁退場模式，改成 redirect stub
// 轉去 /today（RequireAuth 那層會負責等自動登入跑完才放行內容）。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function LoginPage() {
  return <RedirectStub resolve={() => "/today"} />;
}
