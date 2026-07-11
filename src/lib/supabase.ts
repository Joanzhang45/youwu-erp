import { createClient, SupabaseClient, Session } from '@supabase/supabase-js'

// Runtime 模式：未登入 = demo（AuthContext 依 session 有無判斷），不再用 build-time 旗標鎖死。
// RLS 已把 anon 收斂到 0 policy（預設拒），真實資料只有 authenticated（且 uid 綁 Joan 本人）才讀得到，
// 所以即使公開站前端一律載入同一支 bundle，未登入訪客本來就打不到任何真實資料。

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (_client) return _client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('請設定 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  _client = createClient(url, key)
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
