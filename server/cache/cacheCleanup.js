import fs from 'node:fs/promises';
import { cacheConfig } from './config.js';
import { listPreviewRecordsOldest, removeRecord } from './metadataStore.js';

let cleanupTimer = null;
let cleanupRunning = false;

if (cacheConfig.cleanupIntervalMs > 0) {
  const interval = setInterval(() => {
    scheduleCacheCleanup();
  }, cacheConfig.cleanupIntervalMs);
  interval.unref?.();
}

export function scheduleCacheCleanup() {
  if (!cacheConfig.metadataEnabled || cacheConfig.maxBytes <= 0 || cleanupTimer) return;

  cleanupTimer = setTimeout(() => {
    cleanupTimer = null;
    cleanupCache().catch((error) => {
      console.warn(`Cache cleanup failed: ${error.message}`);
    });
  }, 1000);
}

export async function cleanupCache() {
  if (cleanupRunning || !cacheConfig.metadataEnabled || cacheConfig.maxBytes <= 0) return;
  cleanupRunning = true;

  try {
    const records = await listPreviewRecordsOldest();
    let totalBytes = records.reduce((sum, record) => sum + (record.cacheFileSize || 0), 0);
    if (totalBytes <= cacheConfig.maxBytes) return;

    for (const record of records) {
      if (totalBytes <= cacheConfig.maxBytes) break;
      await unlinkIfExists(record.previewPath);
      totalBytes -= record.cacheFileSize || 0;
      await removeRecord(record.key);
    }
  } finally {
    cleanupRunning = false;
  }
}

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
