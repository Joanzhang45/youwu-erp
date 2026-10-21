"use client";

// 登入機制（2026-10-21 改回正常登入）：
// 2026-07-14 的 M7 曾把彣錩帳密寫死在前端做背景自動登入（Joan 當時知情接受，PRD Q9b）。
// 2026-10-21 資安稽核發現：repo 公開且已被陌生帳號 fork，寫死的帳密會隨 JS bundle 公開，
// 等於任何人都能用它直接呼叫 Supabase 讀寫 18 張白名單表，風險不再可接受 → Joan 授權移除。
// 現況：前端不含任何帳密；未登入一律導到 /login，以 email＋密碼 signInWithPassword 登入，
// session 由 supabase-js 存在 localStorage（persistSession: true，key 不變），登一次長期有效。
// RLS policy `authenticated_whitelist`（migration 009，Joan＋彣錩雙 uid）才是真正的防線。
import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getInitialSession, onAuthStateChange } from "./supabase";

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    getInitialSession()
      .then((existing) => {
        if (!mounted) return;
        setSession(existing);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setSession(null);
        setLoading(false);
      });

    const subscription = onAuthStateChange((s) => {
      if (mounted) setSession(s);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
