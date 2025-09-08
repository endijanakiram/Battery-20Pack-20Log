import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  supabase = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { "x-client-info": "battery-pack-log/server" } },
  });
  return supabase;
}

export async function ensureBucket(name: string, isPublic = false) {
  const s = getSupabase();
  if (!s) return;
  const { data: bucketList } = await s.storage.listBuckets();
  const exists = (bucketList || []).some((b) => b.name === name);
  if (!exists) {
    await s.storage.createBucket(name, { public: isPublic, fileSizeLimit: 20 * 1024 * 1024 });
  }
}
