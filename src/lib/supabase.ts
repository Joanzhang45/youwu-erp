import { createClient, SupabaseClient, Session } from '@supabase/supabase-js'

// Runtime 模式（M6，Joan 2026-07-14 拍板）：未登入 = 導去 /login，demo 假資料機制已全站移除
// （見 src/lib/AuthContext.tsx、src/components/app/RequireAuth.tsx）。
// RLS 已把 anon 收斂到 0 policy（預設拒），真實資料只有 authenticated（且 uid 綁 Joan 本人）才讀得到，
// 所以即使公開站前端一律載入同一支 bundle，未登入訪客本來就打不到任何真實資料。
//
// persistSession/autoRefreshToken 明確寫死 true（雖然是 supabase-js v2 預設值，這裡不依賴
// 隱含預設）：目標是彣錩登入一次、session 存 localStorage 長期有效、token 到期前背景自動
// 續期，永不用再看到登入頁。detectSessionInUrl 保持預設 true（OAuth/magic link 用得到，
// email+password 流程不受影響）。

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (_client) return _client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('請設定 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  _client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  })
  return _client
}

export async function signIn(email: string, password: string) {
  return getSupabase().auth.signInWithPassword({ email, password })
}

export async function signOutUser() {
  return getSupabase().auth.signOut()
}

export async function getInitialSession(): Promise<Session | null> {
  const { data } = await getSupabase().auth.getSession()
  return data.session
}

export function onAuthStateChange(
  callback: (session: Session | null) => void
) {
  const {
    data: { subscription },
  } = getSupabase().auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
  return subscription
}
