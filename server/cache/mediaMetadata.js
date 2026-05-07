import crypto from 'node:crypto';
import { cacheConfig } from './config.js';
import { getRecord, upsertRecord } from './metadataStore.js';

export async function getBasicMediaMetadata({ absolutePath, relativePath, name, type, stats }) {
  const key = buildMediaMetadataKey({ absolutePath, stats });
  const fingerprint = {
    cacheVersion: cacheConfig.version,
    sourcePath: absolutePath,
    fileSize: stats.size,
    mtimeMs: stats.mtimeMs
  };
  const cachedRecord = await getRecord(key);

  if (isFreshRecord(cachedRecord, fingerprint)) {
    await upsertRecord(key, { lastAccessedAt: new Date().toISOString() });
    return cachedRecord.metadata;
  }

  const metadata = {
    name,
    path: relativePath,
    type,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    lastAccessedAt: new Date().toISOString()
  };

  await upsertRecord(key, {
    kind: 'media-metadata',
    ...fingerprint,
    metadata,
    lastAccessedAt: metadata.lastAccessedAt
  });

  return metadata;
}

function buildMediaMetadataKey({ absolutePath, stats }) {
  return crypto
    .createHash('sha256')
    .update(['metadata', cacheConfig.version, absolutePath, stats.size, stats.mtimeMs].join('\0'))
    .digest('hex');
}

function isFreshRecord(record, fingerprint) {
  if (!record || record.kind !== 'media-metadata' || !record.metadata) return false;
  return Object.entries(fingerprint).every(([key, value]) => record[key] === value);
}
