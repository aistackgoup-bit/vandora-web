import { timingSafeEqual } from 'crypto';
import { adminClient, readBody } from './_lib/supabase.js';

// Receives contacts from the WhatsApp CRM (or any other tool) and files them under the
// unified customer record. Point the CRM webhook at:
//   https://www.vandora.boutique/api/crm-webhook?secret=<CRM_WEBHOOK_SECRET>&channel=whatsapp
// The secret can also be sent as an "x-webhook-secret" header or "Authorization: Bearer".
// Field names vary between CRMs, so the payload is searched for phone/email/name keys.

const PHONE_KEYS = /^(phone|phone_?number|telefono|tel[eé]fono|celular|mobile|whatsapp|wa_?id|from|number|msisdn)$/i;
const EMAIL_KEYS = /^(email|e_?mail|correo|email_?address)$/i;
const NAME_KEYS = /^(name|full_?name|nombre|nombre_?completo|contact_?name|push_?name|profile_?name|display_?name)$/i;
const FIRST_NAME_KEYS = /^(first_?name|nombres?)$/i;
const LAST_NAME_KEYS = /^(last_?name|apellidos?)$/i;
const INSTAGRAM_KEYS = /^(instagram|ig|ig_?username|instagram_?username)$/i;

function findValue(obj, pattern, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 10) return undefined;
  for (const [key, value] of Object.entries(obj)) {
    if (pattern.test(key) && (typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return String(value).trim();
    }
  }
  for (const value of Object.values(obj)) {
    const found = findValue(value, pattern, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function secretMatches(provided) {
  const expected = process.env.CRM_WEBHOOK_SECRET || '';
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const provided =
    req.query?.secret ||
    req.headers['x-webhook-secret'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secretMatches(provided)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const body = readBody(req);
    const firstName = findValue(body, FIRST_NAME_KEYS);
    const lastName = findValue(body, LAST_NAME_KEYS);
    const contact = {
      phone: findValue(body, PHONE_KEYS),
      email: findValue(body, EMAIL_KEYS),
      name: findValue(body, NAME_KEYS) || [firstName, lastName].filter(Boolean).join(' ') || undefined,
      instagram: findValue(body, INSTAGRAM_KEYS),
    };

    if (!contact.phone && !contact.email) {
      // 200 so the CRM does not retry a payload that will never contain a contact
      return res.status(200).json({ ok: true, ignored: 'no phone or email in payload' });
    }

    const channel = String(req.query?.channel || body.channel || 'whatsapp').toLowerCase().slice(0, 40);
    const eventType = String(body.event || body.event_type || body.type || `${channel}_contact`).slice(0, 60);
    const source = String(req.query?.source || body.source || 'crm').slice(0, 80);
    const raw = JSON.stringify(body);

    const { data: customerId, error } = await adminClient().rpc('upsert_customer', {
      p_phone: contact.phone || null,
      p_email: contact.email || null,
      p_name: contact.name || null,
      p_channel: channel,
      p_event_type: eventType,
      p_source: source,
      p_metadata: raw.length <= 8000 ? body : { truncated: raw.slice(0, 8000) },
      p_instagram: contact.instagram || null,
    });
    if (error) throw error;

    if (!customerId) return res.status(200).json({ ok: true, ignored: 'phone/email not valid' });
    return res.status(200).json({ ok: true, customer_id: customerId });
  } catch (error) {
    console.error('CRM webhook error:', error);
    return res.status(500).json({ error: 'Could not save contact' });
  }
}
