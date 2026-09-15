import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
// 新旧密钥体系都认：旧式 anon key（JWT）或新式 publishable key（sb_publishable_ 开头）
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string)

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '缺少环境变量：VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY（或 VITE_SUPABASE_PUBLISHABLE_KEY），请配置 .env.local'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
