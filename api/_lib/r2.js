import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// R2 credentials live only on the server. The legacy VITE_CLOUDFLARE_* names are
// accepted as a fallback so existing Vercel settings keep working during migration.
const env = (name) => process.env[`R2_${name}`] || process.env[`VITE_CLOUDFLARE_${name}`];

export const r2Config = {
  accountId: env('ACCOUNT_ID'),
  accessKeyId: env('ACCESS_KEY_ID'),
  secretAccessKey: env('SECRET_ACCESS_KEY'),
  bucketName: env('BUCKET_NAME'),
  publicUrl: (env('PUBLIC_URL') || '').replace(/\/$/, ''),
};

export const r2Configured = () =>
  Boolean(r2Config.accountId && r2Config.accessKeyId && r2Config.secretAccessKey && r2Config.bucketName && r2Config.publicUrl);

export const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${r2Config.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: r2Config.accessKeyId || '', secretAccessKey: r2Config.secretAccessKey || '' },
});

export const sanitizeKey = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// Server-side upload (used to keep a permanent copy of files produced elsewhere)
export async function putObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: r2Config.bucketName, Key: key, Body: body, ContentType: contentType }));
  return `${r2Config.publicUrl}/${key}`;
}
