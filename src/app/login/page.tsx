"use client";

// 登入頁（M6，Joan 2026-07-14 拍板：全站移除 demo 假資料模式）。
// 彣錩未登入開站看到假數字會懷疑「系統壞掉」——現在未登入一律先攔在這頁，文案改超白話，
// 不寫任何技術詞、也絕對不把帳密寫進頁面（見全域 CLAUDE.md § Autonomous Action 憑證紀律）。
// 視覺換成全站 Geist 慣例（白底／近黑字／#0070F3 強調色），取代舊版 slate-800/blue-600
// 那套跟改版後其他頁不一致的配色。
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && session) {
    // M5：/ 已改成轉 /today 的 redirect stub，這裡直接指到 /today 省一次轉址跳轉。
    router.replace("/today");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await signIn(email, password);
    setSubmitting(false);
    if (signInError) {
      setError("登入失敗，請確認帳號密碼是否正確");
      return;
    }
    router.push("/today");
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-5 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">有物製所 內部系統</h1>
          <p className="text-sm text-[#8F8F8F] mt-2 leading-relaxed">
            請登入後使用。帳號密碼問瓊安。
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-[#EAEAEA] bg-white p-5 space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">密碼</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-[#EAEAEA] rounded-lg text-sm outline-none focus:border-[#171717] transition-colors duration-150"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-xs text-[#E00]">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-[#171717] text-white font-semibold text-sm active:scale-[0.98] transition-transform duration-150 disabled:opacity-50"
          >
            {submitting ? "登入中..." : "登入"}
          </button>
        </form>
      </div>
    </div>
  );
}
