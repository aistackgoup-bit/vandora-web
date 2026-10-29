import { getSettings, readBody, requireStaff } from './_lib/supabase.js';

// Proxies chat completions so the OpenAI/OpenRouter key never reaches the browser.
// mode "chat": public storefront assistant, limited and with a server-side system prompt.
// mode "admin": staff-only tools (copywriting, alt text, quiz generation).

const DEFAULT_SYSTEM_PROMPT =
  'Eres "Vandora AI", la asistente virtual experta en moda de la tienda exclusiva "Vandora" en Ecuador. Tu tono es elegante, empático, profesional y cálido.';

const MAX_CHAT_MESSAGES = 12;
const MAX_CHAT_CHARS = 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = readBody(req);
    const settings = await getSettings([
      'openai_api_key', 'ai_provider', 'ai_model', 'ai_system_prompt', 'ai_agent_enabled',
    ]);

    const apiKey = settings.openai_api_key;
    if (!apiKey) return res.status(503).json({ error: 'La IA no está configurada todavía.' });

    let messages;
    let maxTokens;

    if (body.mode === 'admin') {
      if (!(await requireStaff(req))) return res.status(401).json({ error: 'Unauthorized' });
      messages = (body.messages || [])
        .filter((m) => ['system', 'user', 'assistant'].includes(m?.role))
        .map((m) => ({ role: m.role, content: String(m.content || '') }));
      maxTokens = 4000;
    } else {
      if (settings.ai_agent_enabled !== 'true') return res.status(403).json({ error: 'Chat deshabilitado' });
      const history = (body.messages || [])
        .filter((m) => ['user', 'assistant'].includes(m?.role))
        .slice(-MAX_CHAT_MESSAGES)
        .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, MAX_CHAT_CHARS) }));
      messages = [{ role: 'system', content: settings.ai_system_prompt || DEFAULT_SYSTEM_PROMPT }, ...history];
      maxTokens = 600;
    }

    if (!messages.length) return res.status(400).json({ error: 'No messages' });

    const isOpenRouter = settings.ai_provider === 'openrouter';
    const response = await fetch(
      isOpenRouter ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(isOpenRouter && { 'HTTP-Referer': 'https://www.vandora.boutique', 'X-Title': 'Vandora Boutique' }),
        },
        body: JSON.stringify({
          model: settings.ai_model || 'gpt-4o-mini',
          messages,
          temperature: typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 2) : 1,
          max_tokens: maxTokens,
        }),
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('AI provider error:', response.status, data);
      return res.status(502).json({ error: data.error?.message || 'Error en la comunicación con la IA.' });
    }

    return res.status(200).json({ content: data.choices?.[0]?.message?.content || '' });
  } catch (error) {
    console.error('AI handler error:', error);
    return res.status(500).json({ error: 'Error en la comunicación con la IA.' });
  }
}
