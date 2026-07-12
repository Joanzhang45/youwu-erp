"use client";

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
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-4 py-6">
        <h1 className="text-2xl font-bold">有物製所 ERP</h1>
        <p className="text-slate-300 text-sm mt-1">登入查看真實資料</p>
      </header>

      <main className="p-4 max-w-sm mx-auto">
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 mt-6 space-y-4"
        >
          <div>
            <label className="block text-xs text-slate-500 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">密碼</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:ring-2 focus:ring-blue-300"
              autoComplete="current-password"
            />
          </div>
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white rounded py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "登入中…" : "登入"}
          </button>
        </form>
      </main>
    </div>
  );
}
