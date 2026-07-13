"use client";

// M7（Joan 2026-07-14 二次拍板，AskUserQuestion 知情確認）：完全移除登入體驗。
// Joan：「這個網站只有我跟彣錩使用，沒有必要做登錄」，已知情接受「財務數字等同公開」的
// 代價（PRD Q9b）。M6 的「未登入導去 /login」整個退場，改成初始化時背景自動登入，
// 全程不需要任何人手動輸入帳密。
//
// ⚠️ 安全性備忘（給未來維護者，看到密碼寫死在這裡不要嚇到，這是刻意設計不是疏漏）：
// 這是純前端 static export（GH Pages，沒有後端可以藏密鑰），auto-login 要能運作，這組帳密
// 必然會被打包進公開發布的 JS bundle——任何人開 devtools／view-source 都看得到，也都能拿
// 這組帳密自己呼叫 Supabase API 讀寫 18 張白名單表。效果上等同財務資料公開，這正是 Joan
// 2026-07-14 已知情接受的代價，不是安全漏洞。帳密見敏感憑證總表 § ERP 前端登入 — 彣錩
// （2026-07-12 M1 建，uid 9f9645f9-907d-4bde-87f6-2bfb1b59bb47）；RLS policy
// `authenticated_whitelist` 雙 uid 白名單（migration 009）不受影響、後端零動。
// 禁止因為「看起來像疏漏」就自作主張改回登入頁或拿掉這組帳密。
const AUTO_LOGIN_EMAIL = "qiongan0208+wenchang@gmail.com";
const AUTO_LOGIN_PASSWORD = "f5eeed7f99b575d8114487f9";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getInitialSession, onAuthStateChange, signIn } from "./supabase";

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  authError: string | null;
  retryAutoLogin: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  authError: null,
  retryAutoLogin: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const retryAutoLogin = useCallback(() => setRetryTick((t) => t + 1), []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      setAuthError(null);
      try {
        const existing = await getInitialSession();
        if (!mounted) return;
        if (existing) {
          setSession(existing);
          setLoading(false);
          return;
        }
        // 沒有既有 session（第一次開站／token 已失效）→ 背景自動登入，不再有 /login 這一關。
        const { data, error } = await signIn(AUTO_LOGIN_EMAIL, AUTO_LOGIN_PASSWORD);
        if (!mounted) return;
        if (error || !data.session) {
          setAuthError(error?.message || "自動登入失敗");
          setLoading(false);
          return;
        }
        setSession(data.session);
        setLoading(false);
      } catch (e) {
        if (!mounted) return;
        setAuthError(e instanceof Error ? e.message : "自動登入失敗");
        setLoading(false);
      }
    })();

    const subscription = onAuthStateChange((s) => {
      if (mounted) setSession(s);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick]);

  return (
    <AuthContext.Provider value={{ session, loading, authError, retryAutoLogin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
