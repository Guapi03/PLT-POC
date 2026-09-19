import { createClient } from '@supabase/supabase-js'

// Vite 环境下使用 import.meta.env 读取环境变量
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase 环境变量未配置或未读取到！')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)