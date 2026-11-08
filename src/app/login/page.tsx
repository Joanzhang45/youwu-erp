"use client";

// 登入頁（2026-11-08 改版）：預設「寄登入連結到信箱」，不用記密碼；點信裡的連結回到這頁就登入完成。
// 密碼登入保留在下方小字（彣錩的帳號 email 是瓊安信箱的別名，連結會寄到瓊安那邊，他仍用密碼）。
// 登入後導回 ?next=（只接受站內路徑），已登入者直接導走。useSearchParams 需包 Suspense（static export）。
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { sendLoginLink, signIn } from "@/lib/supabase";
import { safeNextPath } from "@/lib/postgrestFilter";

// 連結點回來時網址 # 帶錯誤（過期、已用過）→ 轉成中文
function linkErrorFromHash(): string | null {
  if (typeof window === "undefined" || !window.location.hash.includes("error")) return null;
  const h = new URLSearchParams(window.location.hash.slice(1));
  if (!h.get("error")) return null;
  return h.get("error_code") === "otp_expired"
    ? "這個登入連結已經過期或用過了，請再寄一次"
    : "登入連結無效，請再寄一次";
}

function sendErrorText(status: number | undefined, message: string): string {
  if (status === 429 || /rate limit|security purposes/i.test(message)) return "寄太多次了，請過幾分鐘再試";
  if (/signups not allowed|not found|not authorized/i.test(message)) return "這個信箱不是 ERP 的帳號";
  return "寄信失敗，請再試一次";
}

function LoginForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"link" | "password">("link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // 連結過期等錯誤：初值直接從網址 # 讀（useSearchParams 讓這頁只在瀏覽器端渲染，不會有 hydration 落差）
  const [error, setError] = useState<string | null>(linkErrorFromHash);

  useEffect(() => {
    if (!loading && session) router.replace(next);
  }, [loading, session, next, router]);

  useEffect(() => {
    if (linkErrorFromHash()) history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function onSendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const target = email.trim();
    // 回到這一頁（含 basePath），登入後再導去 next
    const redirectTo = `${window.location.origin}${window.location.pathname}?next=${encodeURIComponent(next)}`;
    try {
      const { error: err } = await sendLoginLink(target, redirectTo);
      if (err) setError(sendErrorText(err.status, err.message));
      else setSentTo(target);
    } catch {
      setError("連線失敗，請檢查網路後再試");
    }
    setBusy(false);
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
    "mt-6 w-full px-5 py-3 rounded-xl bg-[#171717] text-white text-sm font-medium disabled:opacity-50 active:scale-[0.97] transition-transform duration-150";
  const switcher = "mt-5 w-full text-center text-sm text-[#6B6B6B] underline underline-offset-4";

  if (sentTo) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-5">
        <div className="w-full max-w-xs">
          <h1 className="text-xl font-semibold text-[#171717]">去信箱收信</h1>
          <p className="text-sm text-[#171717] mt-3 leading-relaxed">
            登入連結已寄到 <span className="font-medium break-all">{sentTo}</span>。
            打開信、點「Log In」那個連結，就會回到 ERP 並完成登入。
          </p>
          <p className="text-sm text-[#6B6B6B] mt-3 leading-relaxed">
            幾分鐘內沒收到，看一下垃圾郵件匣。連結只能用一次。
          </p>
          <button type="button" className={switcher} onClick={() => setSentTo(null)}>
            重寄一次
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-5">
      <form onSubmit={mode === "link" ? onSendLink : onPassword} className="w-full max-w-xs">
        <h1 className="text-xl font-semibold text-[#171717]">有物製所 ERP</h1>
        <p className="text-sm text-[#6B6B6B] mt-1 mb-6">
          {mode === "link" ? "輸入信箱，我們寄登入連結給你，不用密碼" : "登入一次，這台裝置會記住你"}
        </p>
        <label className="block text-sm text-[#171717] mb-1.5" htmlFor="email">電子郵件</label>
        <input id="email" type="email" autoComplete="username" required value={email}
          onChange={(e) => setEmail(e.target.value)} className={input} />
        {mode === "password" && (
          <>
            <label className="block text-sm text-[#171717] mt-4 mb-1.5" htmlFor="password">密碼</label>
            <input id="password" type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} className={input} />
          </>
        )}
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <button type="submit" disabled={busy} className={primary}>
          {mode === "link" ? (busy ? "寄送中…" : "寄登入連結") : busy ? "登入中…" : "登入"}
        </button>
        <button type="button" className={switcher}
          onClick={() => { setMode(mode === "link" ? "password" : "link"); setError(null); }}>
          {mode === "link" ? "改用密碼登入" : "改用信箱連結登入"}
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
