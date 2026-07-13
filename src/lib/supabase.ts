import { createClient, SupabaseClient, Session } from '@supabase/supabase-js'

// Runtime 模式（M7，Joan 2026-07-14 二次拍板）：完全移除登入體驗，AuthProvider 背景自動
// 用彣錩帳號登入（見 src/lib/AuthContext.tsx），不再有「未登入訪客」這個狀態——任何人開站
// 都會被自動登入成同一組帳號。RLS policy `authenticated_whitelist`（migration 009）維持
// Joan＋彣錩雙 uid 白名單不變、後端零動；auto-login 帳密會進公開 bundle 是 Joan 已知情
// 接受的代價（見 AuthContext.tsx 開頭安全性備忘），不是這裡的疏漏。
//
// persistSession/autoRefreshToken 明確寫死 true（雖然是 supabase-js v2 預設值，這裡不依賴
// 隱含預設）：session 存 localStorage 長期有效、token 到期前背景自動續期，加上 auto-login
// 保底，實際效果是「開站永遠是登入態」。detectSessionInUrl 保持預設 true（OAuth/magic link
// 用得到，email+password 流程不受影響）。
//
// signOutUser 保留給日後手動除錯用（目前站內沒有任何地方呼叫）：M7 拿掉的是登出「按鈕」，
// 不是這個工具函式本身——登出後 AuthProvider 下一次 mount 會自動重新登入，UI 層面留登出
// 入口沒有意義，但保留函式方便必要時用瀏覽器 console 手動呼叫排查。

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
