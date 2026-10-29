import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { readBody, requireStaff } from './_lib/supabase.js';

// R2 credentials live only on the server. The legacy VITE_CLOUDFLARE_* names are
// accepted as a fallback so existing Vercel settings keep working during migration.
const env = (name) => process.env[`R2_${name}`] || process.env[`VITE_CLOUDFLARE_${name}`];

const accountId = env('ACCOUNT_ID');
const accessKeyId = env('ACCESS_KEY_ID');
const secretAccessKey = env('SECRET_ACCESS_KEY');
const bucketName = env('BUCKET_NAME');
const publicUrl = (env('PUBLIC_URL') || '').replace(/\/$/, '');

const ALLOWED_FOLDERS = ['products', 'quiz-video', 'quiz-image', 'quiz-audio', 'media'];
const ALLOWED_TYPES = /^(image\/(png|jpe?g|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|wav|x-wav|ogg|webm|aac))$/;

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: accessKeyId || '', secretAccessKey: secretAccessKey || '' },
});

const sanitize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
    return res.status(500).json({ error: 'Storage is not configured' });
  }

  try {
    if (!(await requireStaff(req))) return res.status(401).json({ error: 'Unauthorized' });
    const body = readBody(req);

    if (body.action === 'upload') {
      const { fileName, contentType, folder, customName } = body;
      if (!ALLOWED_TYPES.test(contentType || '')) {
        return res.status(400).json({ error: 'File type not allowed' });
      }
      const dir = ALLOWED_FOLDERS.includes(folder) ? folder : 'media';
      const ext = sanitize(String(fileName || '').split('.').pop()) || 'bin';
      const base = sanitize(customName) || crypto.randomUUID();
      const key = `${dir}/${base}.${ext}`;

      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: bucketName, Key: key, ContentType: contentType }),
        { expiresIn: 300 }
      );
      return res.status(200).json({ uploadUrl, url: `${publicUrl}/${key}`, path: key });
    }

    if (body.action === 'delete') {
      let key = String(body.path || '');
      if (key.startsWith(publicUrl)) key = key.slice(publicUrl.length + 1);
      if (!key || key.includes('..')) return res.status(400).json({ error: 'Invalid path' });

      await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Storage error:', error);
    return res.status(500).json({ error: 'Storage operation failed' });
  }
}
