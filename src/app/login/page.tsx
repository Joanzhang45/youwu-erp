"use client";

// 登入頁（2026-11-08 改版）：預設「用 Google 登入」，按一下選帳號就進來。
// 密碼登入保留在下方小字（彣錩的帳號 email 是瓊安信箱的別名，沒有自己的 Google 帳號可綁，他仍用密碼）。
// 登入後導回 ?next=（只接受站內路徑），已登入者直接導走。useSearchParams 需包 Suspense（static export）。
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { signIn, signInWithGoogle } from "@/lib/supabase";
import { safeNextPath } from "@/lib/postgrestFilter";

// Google 登入失敗時 Supabase 把錯誤帶在網址 # 或 ? 裡 → 轉成中文
function oauthErrorFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.slice(1) + "&" + window.location.search.slice(1);
  const p = new URLSearchParams(raw);
  if (!p.get("error")) return null;
  const desc = p.get("error_description") ?? "";
  return /signups? not allowed|not allowed/i.test(desc)
    ? "這個 Google 帳號不是 ERP 的帳號，請換一個帳號"
    : "Google 登入沒有完成，請再試一次";
}

function LoginForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const { session, loading } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // 初值直接從網址讀（useSearchParams 讓這頁只在瀏覽器端渲染，不會有 hydration 落差）
  const [error, setError] = useState<string | null>(oauthErrorFromUrl);

  useEffect(() => {
    if (!loading && session) router.replace(next);
  }, [loading, session, next, router]);

  useEffect(() => {
    if (oauthErrorFromUrl()) {
      history.replaceState(null, "", `${window.location.pathname}?next=${encodeURIComponent(next)}`);
    }
  }, [next]);

  async function onGoogle() {
    setBusy(true);
    setError(null);
    // 回到這一頁（含 basePath），登入後再導去 next
    const redirectTo = `${window.location.origin}${window.location.pathname}?next=${encodeURIComponent(next)}`;
    try {
      const { error: err } = await signInWithGoogle(redirectTo);
      if (err) {
        setError("Google 登入沒有完成，請再試一次");
        setBusy(false);
      }
      // 成功時瀏覽器整頁跳去 Google，不用處理
    } catch {
      setError("連線失敗，請檢查網路後再試");
      setBusy(false);
    }
  }

  async function onPassword(e: React.FormEvent) {
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
  const primary =
    "w-full px-5 py-3 rounded-xl bg-[#171717] text-white text-sm font-medium disabled:opacity-50 active:scale-[0.97] transition-transform duration-150";
  const switcher = "mt-5 w-full text-center text-sm text-[#6B6B6B] underline underline-offset-4";

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-5">
      <div className="w-full max-w-xs">
        <h1 className="text-xl font-semibold text-[#171717]">有物製所 ERP</h1>
        <p className="text-sm text-[#6B6B6B] mt-1 mb-6">
          {showPassword ? "登入一次，這台裝置會記住你" : "用你的 Google 帳號登入，不用密碼"}
        </p>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        {!showPassword ? (
          <button type="button" disabled={busy} onClick={onGoogle} className={primary}>
            {busy ? "前往 Google…" : "用 Google 登入"}
          </button>
        ) : (
          <form onSubmit={onPassword}>
            <label className="block text-sm text-[#171717] mb-1.5" htmlFor="email">電子郵件</label>
            <input id="email" type="email" autoComplete="username" required value={email}
              onChange={(e) => setEmail(e.target.value)} className={input} />
            <label className="block text-sm text-[#171717] mt-4 mb-1.5" htmlFor="password">密碼</label>
            <input id="password" type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} className={input} />
            <button type="submit" disabled={busy} className={`mt-6 ${primary}`}>
              {busy ? "登入中…" : "登入"}
            </button>
          </form>
        )}
        <button type="button" className={switcher}
          onClick={() => { setShowPassword(!showPassword); setError(null); }}>
          {showPassword ? "改用 Google 登入" : "改用密碼登入"}
        </button>
      </div>
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
