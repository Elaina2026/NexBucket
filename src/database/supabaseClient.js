import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; 
const customFetch = async (url, options) => {
  try {
    return await fetch(url, { ...options, signal: options?.signal || AbortSignal.timeout(15000) });
  } catch (err) {
    if (err.message === 'fetch failed' || err.name === 'TimeoutError' || err.code === 'UND_ERR_CONNECT_TIMEOUT' || err.name === 'AbortError') {
      return new Response(JSON.stringify({ 
        message: 'Database connection timed out (Database might be paused/sleeping)',
        code: 'TIMEOUT',
        details: 'Supabase is currently unreachable.'
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw err;
  }
};
export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
  global: { fetch: customFetch }
}) : null;
export async function initDatabase() {
  if (!supabase) {
    console.warn('⚠️ [Database] SUPABASE_URL or SUPABASE_KEY is missing in .env. Bot might not function properly without a database.');
    return;
  }
  try {
    console.log('🔄 [Database] Connecting to Supabase and checking tables...');
    let data, error;
    try {
      const result = await supabase.from('guild_settings').select('guild_id').limit(1);
      data = result.data;
      error = result.error;
    } catch (err) {
      error = err;
    }
    if (error && error.code === '42P01') {
      console.error('❌ [Database] Tables do not exist. Run migrations first (npm start runs them automatically).');
    } else {
      console.log('✅ [Database] Connected to Supabase PostgreSQL successfully!');
    }
    setInterval(async () => {
      try {
        await supabase.from('guild_settings').select('guild_id').limit(1);
      } catch (err) {
        console.error('[Database Ping] Failed to ping database:', err.message);
      }
    }, 1 * 60 * 1000); 
  } catch (error) {
    console.error('❌ [Database] Connection failed:', error.message);
  }
}
