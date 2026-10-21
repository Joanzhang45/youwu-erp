"use client";

// 正式登入頁（2026-10-21）：email＋密碼，Supabase signInWithPassword，session 持久化在 localStorage。
// 登入後導回 ?next=（只接受站內路徑），已登入者直接導走。useSearchParams 需包 Suspense（static export）。
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { signIn } from "@/lib/supabase";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) return "/today";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && session) router.replace(next);
  }, [loading, session, next, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await signIn(email.trim(), password);
      if (err || !data.session) {
        setError("帳號或密碼不對，請再試一次");
        setBusy(false);
        return;
      }
      router.replace(next);
    } catch {
      setError("連線失敗，請檢查網路後再試");
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-xl border border-[#EAEAEA] px-4 py-3 text-base text-[#171717] outline-none focus:border-[#171717]";

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-5">
      <form onSubmit={onSubmit} className="w-full max-w-xs">
        <h1 className="text-xl font-semibold text-[#171717]">有物製所 ERP</h1>
        <p className="text-sm text-[#8F8F8F] mt-1 mb-6">登入一次，這台裝置會記住你</p>
        <label className="block text-sm text-[#171717] mb-1.5" htmlFor="email">電子郵件</label>
        <input id="email" type="email" autoComplete="username" required value={email}
          onChange={(e) => setEmail(e.target.value)} className={input} />
        <label className="block text-sm text-[#171717] mt-4 mb-1.5" htmlFor="password">密碼</label>
        <input id="password" type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} className={input} />
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <button type="submit" disabled={busy}
          className="mt-6 w-full px-5 py-3 rounded-xl bg-[#171717] text-white text-sm font-medium disabled:opacity-50 active:scale-[0.97] transition-transform duration-150">
          {busy ? "登入中…" : "登入"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <LoginForm />
    </Suspense>
  );
}
