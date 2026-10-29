import { adminClient } from './supabase.js';
import { putObject, sanitizeKey } from './r2.js';

// kie.ai image editing (Nano Banana edit). Docs: https://docs.kie.ai/market/google/nano-banana-edit
const KIE_API = 'https://api.kie.ai/api/v1/jobs';
export const KIE_MODEL = 'google/nano-banana-edit';

// Every preset starts from this, because product photos are only useful if the garment is exact.
const FIDELITY =
  'Use the garment in the reference photo(s) as the only product. Keep it exactly identical: same color and shade, ' +
  'fabric texture, pattern, buttons, seams, collar, pockets, length and proportions. Do not add, remove or redesign ' +
  'any detail, logo or accessory. Photorealistic, high resolution, sharp focus, professional fashion e-commerce photography.';

export const PRESETS = {
  marketplace_blanco: {
    aspect_ratio: '1:1',
    prompt:
      'Place the garment on a pure white seamless background (#FFFFFF), centered, fully visible with even margins, ' +
      'shown as an invisible ghost mannequin so it keeps its natural 3D shape. Soft even studio lighting, a subtle ' +
      'contact shadow, no props, no text.',
  },
  estudio_neutro: {
    aspect_ratio: '4:5',
    prompt:
      'Place the garment on a warm off-white / light beige seamless studio background, centered, shown as an invisible ' +
      'ghost mannequin with natural 3D shape. Soft diffused light from the left, gentle shadow, minimal and elegant, ' +
      'premium boutique look, no props, no text.',
  },
  historia_vertical: {
    aspect_ratio: '9:16',
    prompt:
      'Vertical 9:16 ad image: the garment on a clean light neutral studio background, centered slightly below the middle, ' +
      'shown as an invisible ghost mannequin, leaving generous empty space at the top and bottom for text overlays. ' +
      'Soft studio light, no props, no text.',
  },
  plano_detalle: {
    aspect_ratio: '4:5',
    prompt:
      'Neat flat lay of the garment seen from directly above on a clean light linen-textured surface, perfectly folded ' +
      'and arranged, soft natural daylight, no props, no text.',
  },
  modelo_estudio: {
    aspect_ratio: '4:5',
    prompt:
      'A Latin American woman in her late twenties to thirties, natural and elegant, wearing the garment, standing in a ' +
      'relaxed confident pose, full body or three-quarter shot, on a clean light grey studio background. Neutral ' +
      'complementary clothing (plain trousers, simple shoes) so the garment is the focus. Soft studio light, no text.',
  },
};

export const ASPECT_RATIOS = ['1:1', '4:5', '3:4', '9:16', '16:9', '2:3', '3:2'];

const kieKey = () => process.env.KIE_API_KEY;

async function kieFetch(path, init = {}) {
  const res = await fetch(`${KIE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${kieKey()}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  // kie.ai answers HTTP 200 even on errors: the real status is json.code
  if (!res.ok || json.code !== 200) {
    const err = new Error(json.msg || `kie.ai error ${json.code || res.status}`);
    err.code = json.code || res.status;
    throw err;
  }
  return json.data;
}

export const buildPrompt = (presetKey, color, extra) => {
  const preset = PRESETS[presetKey];
  return [
    FIDELITY,
    preset.prompt,
    color ? `The garment color is "${color}"; reproduce exactly the color shown in the reference photo.` : '',
    extra ? `Additional instructions: ${String(extra).slice(0, 1000)}` : '',
  ].filter(Boolean).join('\n\n');
};

export async function createKieTask({ prompt, imageUrls, aspectRatio, callBackUrl }) {
  const data = await kieFetch('/createTask', {
    method: 'POST',
    body: JSON.stringify({
      model: KIE_MODEL,
      callBackUrl,
      input: { prompt, image_urls: imageUrls, output_format: 'png', aspect_ratio: aspectRatio },
    }),
  });
  return data.taskId;
}

export const getKieTask = (taskId) => kieFetch(`/recordInfo?taskId=${encodeURIComponent(taskId)}`);

// Reads the authoritative task state from kie.ai and, once finished, copies the images to R2
// and files them for review. Safe to call repeatedly (callback retries, polling, both at once).
export async function syncJob(job, { db = adminClient(), put = putObject } = {}) {
  if (!job.kie_task_id || ['success', 'failed', 'finalizing'].includes(job.status)) return job.status;

  const task = await getKieTask(job.kie_task_id);

  if (task.state === 'fail') {
    await db.from('image_jobs')
      .update({ status: 'failed', error: task.failMsg || 'La generación falló', completed_at: new Date().toISOString() })
      .eq('id', job.id).in('status', ['queued', 'processing']);
    return 'failed';
  }

  if (task.state !== 'success') {
    if (job.status === 'queued') await db.from('image_jobs').update({ status: 'processing' }).eq('id', job.id).eq('status', 'queued');
    return 'processing';
  }

  // Claim the job so concurrent callers do not copy the images twice
  const { data: claimed } = await db.from('image_jobs')
    .update({ status: 'finalizing' })
    .eq('id', job.id).in('status', ['queued', 'processing'])
    .select('id');
  if (!claimed?.length) return 'finalizing';

  try {
    let urls = [];
    try {
      urls = JSON.parse(task.resultJson || '{}').resultUrls || [];
    } catch {
      urls = task.response?.resultUrls || [];
    }
    if (!urls.length) throw new Error('kie.ai no devolvió imágenes');

    const { data: product } = job.product_id
      ? await db.from('products').select('slug, name').eq('id', job.product_id).maybeSingle()
      : { data: null };
    const folder = `ai/${sanitizeKey(product?.slug || product?.name || 'sin-producto')}`;

    const rows = [];
    for (const [i, url] of urls.entries()) {
      const file = await fetch(url);
      if (!file.ok) throw new Error(`No se pudo descargar la imagen generada (${file.status})`);
      const type = file.headers.get('content-type') || 'image/png';
      const ext = type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png';
      const key = `${folder}/${sanitizeKey(job.preset)}-${sanitizeKey(job.color || 'unico')}-${job.id.slice(0, 8)}-${i + 1}.${ext}`;
      const publicUrl = await put(key, Buffer.from(await file.arrayBuffer()), type);
      rows.push({ job_id: job.id, product_id: job.product_id, color: job.color, preset: job.preset, url: publicUrl });
    }

    const { error: insertError } = await db.from('generated_images').insert(rows);
    if (insertError) throw insertError;
    await db.from('image_jobs').update({
      status: 'success',
      credits_consumed: task.creditsConsumed ?? null,
      completed_at: new Date().toISOString(),
    }).eq('id', job.id);
    return 'success';
  } catch (error) {
    // Release the claim so a later callback or poll can retry the copy
    await db.from('image_jobs').update({ status: 'processing', error: String(error.message || error).slice(0, 500) }).eq('id', job.id);
    throw error;
  }
}
