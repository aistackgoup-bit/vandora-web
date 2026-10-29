import { createHmac, timingSafeEqual } from 'crypto';
import { adminClient, readBody } from './_lib/supabase.js';
import { syncJob } from './_lib/kie.js';

// kie.ai calls this when a generation finishes. The payload is never trusted: the job is
// identified by its id + per-job secret token in the URL, and the result is re-read from
// kie.ai's API with our key. If KIE_WEBHOOK_HMAC_KEY is set, the kie.ai signature is checked too.

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { job: jobId, token } = req.query || {};
    if (!jobId || !token) return res.status(400).json({ error: 'Missing job' });

    const db = adminClient();
    const { data: job } = await db.from('image_jobs').select('*').eq('id', jobId).maybeSingle();
    if (!job || !safeEqual(token, job.callback_token)) return res.status(401).json({ error: 'Unauthorized' });

    const hmacKey = process.env.KIE_WEBHOOK_HMAC_KEY;
    if (hmacKey) {
      const body = readBody(req);
      const taskId = body?.data?.taskId || body?.data?.task_id || job.kie_task_id;
      const timestamp = req.headers['x-webhook-timestamp'];
      const expected = createHmac('sha256', hmacKey).update(`${taskId}.${timestamp}`).digest('base64');
      if (!timestamp || !safeEqual(expected, req.headers['x-webhook-signature'])) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const status = await syncJob(job);
    return res.status(200).json({ ok: true, status });
  } catch (error) {
    console.error('kie-callback error:', error);
    // 500 lets kie.ai retry; the admin panel also polls as a fallback
    return res.status(500).json({ error: 'Callback processing failed' });
  }
}
