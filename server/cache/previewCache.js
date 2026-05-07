import fs from 'node:fs/promises';
import path from 'node:path';
import { cacheConfig } from './config.js';
import { buildPreviewCacheKey, buildPreviewFingerprint, buildPreviewPath, previewFormatFor } from './cacheKeys.js';
import { getRecord, upsertRecord } from './metadataStore.js';
import { enqueuePreviewTask } from './previewQueue.js';
import { scheduleCacheCleanup } from './cacheCleanup.js';
import { createImagePreview } from './generators/imagePreview.js';
import { createVideoPreview } from './generators/videoPreview.js';

export async function getPreviewFile(sourcePath, stats, type, size) {
  await fs.mkdir(cacheConfig.previewDir, { recursive: true });

  const cacheKey = buildPreviewCacheKey({ sourcePath, stats, type, size });
  const previewPath = buildPreviewPath(cacheKey, type);
  const fingerprint = buildPreviewFingerprint({ sourcePath, stats, type, size });
  const cachedRecord = await getRecord(cacheKey);

  if (isFreshRecord(cachedRecord, fingerprint) && await exists(previewPath)) {
    await touchPreviewRecord(cacheKey);
    return previewPath;
  }

  if (await exists(previewPath)) {
    const previewStats = await fs.stat(previewPath);
    await saveReadyRecord(cacheKey, previewPath, previewStats.size, fingerprint);
    return previewPath;
  }

  return enqueuePreviewTask(cacheKey, async () => {
    if (await exists(previewPath)) {
      const previewStats = await fs.stat(previewPath);
      await saveReadyRecord(cacheKey, previewPath, previewStats.size, fingerprint);
      return previewPath;
    }

    await upsertRecord(cacheKey, {
      kind: 'preview',
      ...fingerprint,
      status: 'generating',
      previewPath
    });

    const temporaryPath = path.join(
      cacheConfig.previewDir,
      `${cacheKey}.${process.pid}.${Date.now()}.tmp.${path.extname(previewPath).slice(1)}`
    );

    try {
      if (type === 'image') {
        await createImagePreview(sourcePath, temporaryPath, size);
      } else {
        await createVideoPreview(sourcePath, temporaryPath, size);
      }
      await fs.rename(temporaryPath, previewPath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});

      if (await exists(previewPath)) {
        const previewStats = await fs.stat(previewPath);
        await saveReadyRecord(cacheKey, previewPath, previewStats.size, fingerprint);
        return previewPath;
      }

      await upsertRecord(cacheKey, {
        kind: 'preview',
        ...fingerprint,
        status: 'error',
        previewPath,
        error: error.message,
        lastAccessedAt: new Date().toISOString()
      });
      throw error;
    }

    const previewStats = await fs.stat(previewPath);
    await saveReadyRecord(cacheKey, previewPath, previewStats.size, fingerprint);
    scheduleCacheCleanup();
    return previewPath;
  });
}

export function previewContentTypeFor(type) {
  return type === 'image' ? `image/${previewFormatFor(type)}` : 'image/jpeg';
}

async function saveReadyRecord(cacheKey, previewPath, cacheFileSize, fingerprint) {
  await upsertRecord(cacheKey, {
    kind: 'preview',
    ...fingerprint,
    status: 'ready',
    previewPath,
    cacheFileSize,
    lastAccessedAt: new Date().toISOString()
  });
}

async function touchPreviewRecord(cacheKey) {
  await upsertRecord(cacheKey, {
    lastAccessedAt: new Date().toISOString()
  });
}

function isFreshRecord(record, fingerprint) {
  if (!record || record.status !== 'ready') return false;

  return Object.entries(fingerprint).every(([key, value]) => record[key] === value);
}

async function exists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}
