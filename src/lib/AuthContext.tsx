"use client";

// Joan 2026-07-14 拍板：全站移除 demo 假資料模式。彣錩未登入開站看到假數字，直接懷疑
// 「系統壞掉」——對真實使用者是反效果。未登入 = 導去 /login，不再有第二種「先用假資料
// 逛逛」的分支，所以這裡不再輸出 isDemo，只留 session／loading 給頁面判斷「要不要放行」
// （見 src/components/app/RequireAuth.tsx，9 個受保護頁共用這層）。
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

    getInitialSession().then((s) => {
      if (mounted) {
        setSession(s);
        setLoading(false);
      }
    });

    const subscription = onAuthStateChange((s) => {
      if (mounted) setSession(s);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
