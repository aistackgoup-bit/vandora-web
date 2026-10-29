import { randomBytes } from 'crypto';
import { adminClient, readBody, requireStaff } from './_lib/supabase.js';
import { r2Config, r2Configured } from './_lib/r2.js';
import { ASPECT_RATIOS, KIE_MODEL, PRESETS, buildPrompt, createKieTask, syncJob } from './_lib/kie.js';

// Staff-only entry point of the AI photo studio.
//   { action: "create", product_id, color, preset, source_urls[], aspect_ratio?, variations?, extra? }
//   { action: "refresh", job_ids[] }   → asks kie.ai for jobs whose callback has not arrived yet

const MAX_VARIATIONS = 4;
const MAX_SOURCES = 5;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await requireStaff(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!process.env.KIE_API_KEY) return res.status(503).json({ error: 'Falta configurar KIE_API_KEY en Vercel.' });
    if (!r2Configured()) return res.status(503).json({ error: 'El almacenamiento R2 no está configurado.' });

    const body = readBody(req);
    const db = adminClient();

    if (body.action === 'refresh') {
      const ids = (Array.isArray(body.job_ids) ? body.job_ids : []).slice(0, 20);
      const { data: jobs } = await db.from('image_jobs').select('*').in('id', ids);
      const statuses = {};
      for (const job of jobs || []) {
        // A copy interrupted by a timeout leaves the job "finalizing": let it be retried
        if (job.status === 'finalizing' && Date.now() - new Date(job.created_at).getTime() > 10 * 60 * 1000) {
          await db.from('image_jobs').update({ status: 'processing' }).eq('id', job.id).eq('status', 'finalizing');
          job.status = 'processing';
        }
        try {
          statuses[job.id] = await syncJob(job);
        } catch (error) {
          console.error('kie refresh error', job.id, error);
          statuses[job.id] = job.status;
        }
      }
      return res.status(200).json({ statuses });
    }

    if (body.action !== 'create') return res.status(400).json({ error: 'Unknown action' });

    const preset = PRESETS[body.preset] ? body.preset : null;
    if (!preset) return res.status(400).json({ error: 'Plantilla no válida' });

    // Only our own public images may be sent to kie.ai
    const sources = (Array.isArray(body.source_urls) ? body.source_urls : [])
      .filter((u) => typeof u === 'string' && u.startsWith(`${r2Config.publicUrl}/`))
      .slice(0, MAX_SOURCES);
    if (!sources.length) return res.status(400).json({ error: 'Elige al menos una foto de referencia del producto.' });

    const aspectRatio = ASPECT_RATIOS.includes(body.aspect_ratio) ? body.aspect_ratio : PRESETS[preset].aspect_ratio;
    const variations = Math.min(Math.max(parseInt(body.variations, 10) || 1, 1), MAX_VARIATIONS);
    const color = body.color ? String(body.color).slice(0, 80) : null;
    const prompt = buildPrompt(preset, color, body.extra);
    const origin = process.env.PUBLIC_SITE_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

    // Nano Banana edit returns one image per task, so each variation is its own job
    const jobs = [];
    for (let i = 0; i < variations; i++) {
      const token = randomBytes(24).toString('hex');
      const { data: job, error } = await db.from('image_jobs').insert({
        product_id: body.product_id || null,
        color,
        preset,
        prompt,
        aspect_ratio: aspectRatio,
        source_urls: sources,
        model: KIE_MODEL,
        callback_token: token,
        created_by: user.id,
      }).select('id').single();
      if (error) throw error;

      try {
        const taskId = await createKieTask({
          prompt,
          imageUrls: sources,
          aspectRatio,
          callBackUrl: `${origin}/api/kie-callback?job=${job.id}&token=${token}`,
        });
        await db.from('image_jobs').update({ kie_task_id: taskId, status: 'processing' }).eq('id', job.id);
        jobs.push(job.id);
      } catch (error) {
        await db.from('image_jobs').update({ status: 'failed', error: error.message, completed_at: new Date().toISOString() }).eq('id', job.id);
        // Out of credits / bad key: stop instead of failing every variation
        if ([401, 402].includes(error.code)) {
          return res.status(402).json({ error: error.code === 402 ? 'No hay créditos suficientes en kie.ai.' : 'La clave de kie.ai no es válida.', job_ids: jobs });
        }
        throw error;
      }
    }

    return res.status(200).json({ job_ids: jobs });
  } catch (error) {
    console.error('kie-image error:', error);
    return res.status(500).json({ error: error.message || 'No se pudo generar la imagen' });
  }
}
