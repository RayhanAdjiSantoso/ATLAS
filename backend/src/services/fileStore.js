import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

// Where uploaded files' bytes live: Cloudflare R2 (S3-compatible), bucket
// R2_BUCKET. Postgres keeps only each file's row — who, which brand, which
// month — and its object key (storage_key); the bytes stay out of Neon, so
// reading a file costs no database transfer, and moving ATLAS to another
// host later means moving the database only.
//
// Until R2_* is configured (or while a row still holds its bytes from before
// the move) everything works as before: callers read `raw_file` first and
// fall back to the object (readBytes), and writes keep the bytes in the row
// when R2 is off or the upload to it fails (storeBytes).

const env = (k) => (process.env[k] || '').trim();

let client = null;
export function isEnabled() {
  return Boolean(env('R2_ENDPOINT') && env('R2_ACCESS_KEY_ID') && env('R2_SECRET_ACCESS_KEY') && env('R2_BUCKET'));
}
function s3() {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: env('R2_ENDPOINT'),
      credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') },
      maxAttempts: 2,
    });
  }
  return client;
}
const bucket = () => env('R2_BUCKET');

// Object keys: a folder per kind of file, a random id (a replaced file gets
// a new object, so a half-finished replace never clobbers the old bytes), and
// the readable original name at the end.
const safe = (name) => String(name ?? 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-120) || 'file';
export const keys = {
  library: (brandId, name) => `library/${brandId}/${randomUUID()}-${safe(name)}`,
  upload: (uploadId, name) => `uploads/${uploadId}-${safe(name)}`,
  reportRun: (runId, name) => `report-runs/${runId}/${randomUUID()}-${safe(name)}`,
  homepage: (mime) => `homepage/${randomUUID()}.${String(mime || '').split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin'}`,
};

export async function putBytes(key, bytes, contentType = 'application/octet-stream') {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: bytes, ContentType: contentType }));
  return key;
}

export async function getBytes(key) {
  const out = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return Buffer.from(await out.Body.transformToByteArray());
}

export async function deleteBytes(key) {
  if (!key || !isEnabled()) return;
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

// A short-lived link straight to the object (private bucket), for downloads
// that need not pass through the API at all.
export function signedUrl(key, { seconds = 300, filename } = {}) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: bucket(), Key: key,
      ...(filename ? { ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` } : {}),
    }),
    { expiresIn: seconds },
  );
}

// Store a file's bytes for a row about to be written: in R2 when it is on
// (→ { storageKey, rawFile: null }), else — or if R2 refuses — in the row
// itself (→ { storageKey: null, rawFile: bytes }), so an upload never fails
// because of the object store.
export async function storeBytes(key, bytes, contentType) {
  if (!bytes || !isEnabled()) return { storageKey: null, rawFile: bytes ?? null };
  try {
    await putBytes(key, bytes, contentType);
    return { storageKey: key, rawFile: null };
  } catch (err) {
    console.warn(`[fileStore] R2 upload failed for ${key}, keeping the bytes in Postgres:`, err?.name || err?.message);
    return { storageKey: null, rawFile: bytes };
  }
}

// A row's bytes, wherever they are: still in the row (before the move), or
// in R2 under its storage_key. null when neither holds them.
export async function readBytes({ rawFile, storageKey }) {
  if (rawFile) return Buffer.isBuffer(rawFile) ? rawFile : Buffer.from(rawFile);
  if (storageKey && isEnabled()) return getBytes(storageKey);
  return null;
}

export async function ping() {
  await s3().send(new HeadBucketCommand({ Bucket: bucket() }));
  return true;
}
