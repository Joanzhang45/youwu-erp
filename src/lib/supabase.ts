import { createClient, SupabaseClient, Session } from '@supabase/supabase-js'

// Runtime 模式（2026-10-21 改回正常登入）：前端不含任何帳密，未登入導 /login（見
// src/lib/AuthContext.tsx、src/components/app/RequireAuth.tsx）。RLS policy
// `authenticated_whitelist`（migration 009，Joan＋彣錩雙 uid）才是資料防線。
//
// persistSession/autoRefreshToken 明確寫死 true（雖是 supabase-js v2 預設值，不依賴隱含預設）：
// session 存 localStorage（storage key 維持預設，既有登入態沿用）、token 到期前背景自動續期，
// 登一次長期有效。detectSessionInUrl 保持預設 true。
//
// signOutUser：「更多」頁的登出按鈕（第二次健檢 #22）。scope 'local' 只登出這台，
// 'global' 讓這個帳號所有裝置的登入一起失效（手機掉了時用）。

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

// 信箱登入連結（2026-11-08 瓊安要求：不用記密碼）。shouldCreateUser:false＝只寄給已存在的帳號，
// 陌生 email 不會因此被建立帳號。redirectTo 必須在 Supabase 後台 URL Configuration 的允許清單內，
// 不在清單時 Supabase 會改導到 Site URL。implicit flow（supabase-js 預設）：連結在任何瀏覽器開都能登入，
// 回到 /login 後 detectSessionInUrl 從網址 # 取出 session。
export async function sendLoginLink(email: string, redirectTo: string) {
  return getSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  })
}

export async function signOutUser(scope: 'local' | 'global' = 'local') {
  return getSupabase().auth.signOut({ scope })
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
