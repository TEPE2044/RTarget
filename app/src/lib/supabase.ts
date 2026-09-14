import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('缺少环境变量 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，请配置 .env.local')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
