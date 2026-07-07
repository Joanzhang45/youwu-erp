import { createClient, SupabaseClient } from '@supabase/supabase-js'

// 公開站（GitHub Pages）build env 固定寫 'true'；本機 .env.local 寫 'false' 看真實資料。
// 不用「有沒有設 URL」判斷，因為 GitHub Actions secret 一直有設 URL，會導致公開站誤判成非 demo。
export const isDemo = process.env.NEXT_PUBLIC_IS_DEMO === 'true'

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
