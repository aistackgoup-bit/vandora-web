import { createClient } from '@supabase/supabase-js';

// Files under api/_lib are shared helpers; Vercel does not expose them as routes.

const STAFF_ROLES = ['superadmin', 'admin', 'editor', 'support'];

// Service-role client: bypasses RLS, so it can read secret settings. Server only.
export function adminClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// Returns the user when the bearer token belongs to a staff member, otherwise null.
export async function requireStaff(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const supabase = adminClient();
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const role = (profile?.role || '').toLowerCase().trim();
  return STAFF_ROLES.includes(role) ? user : null;
}

export async function getSettings(keys) {
  const { data, error } = await adminClient().from('app_settings').select('key, value').in('key', keys);
  if (error) throw error;
  return Object.fromEntries((data || []).map((row) => [row.key, row.value]));
}

export function readBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
}
