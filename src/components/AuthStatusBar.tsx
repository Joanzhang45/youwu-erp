"use client";

import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { signOutUser } from "@/lib/supabase";

export function AuthStatusBar() {
  const { session, isDemo, loading } = useAuth();

  if (loading) return null;

  return (
    <div className="bg-slate-900 text-slate-300 text-xs px-4 py-1 flex items-center justify-end gap-2">
      {isDemo ? (
        <>
          <span className="px-1.5 py-0.5 rounded bg-amber-400 text-amber-900 font-medium">
            展示模式
          </span>
          <Link href="/login" className="text-blue-300 hover:text-blue-200 underline">
            登入
          </Link>
        </>
      ) : (
        <>
          <span className="text-slate-400">{session?.user.email}</span>
          <button
            onClick={() => signOutUser()}
            className="text-blue-300 hover:text-blue-200 underline"
          >
            登出
          </button>
        </>
      )}
    </div>
  );
}
