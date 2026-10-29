import { supabase } from './supabase';

export type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// Calls /api/ai, which holds the provider key. "chat" is the public storefront assistant;
// "admin" sends the staff session token and is used by the admin tools.
export const askAI = async (
  messages: AIMessage[],
  { mode = 'admin', temperature }: { mode?: 'chat' | 'admin'; temperature?: number } = {}
): Promise<string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (mode === 'admin') {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) headers.Authorization = `Bearer ${session.access_token}`;
  }

  const res = await fetch('/api/ai', {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode, messages, temperature }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error en la comunicación con la IA.');
  return (data.content || '').trim();
};
