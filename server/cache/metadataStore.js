import fs from 'node:fs/promises';
import path from 'node:path';
import { cacheConfig } from './config.js';

let loaded = false;
let saveTimer = null;
let savePromise = Promise.resolve();
const records = new Map();

export async function getRecord(key) {
  if (!cacheConfig.metadataEnabled) return null;
  await loadStore();
  return records.get(key) || null;
}

export async function upsertRecord(key, record) {
  if (!cacheConfig.metadataEnabled) return;
  await loadStore();
  records.set(key, {
    ...records.get(key),
    ...record,
    key,
    updatedAt: new Date().toISOString()
  });
  scheduleSave();
}

export async function removeRecord(key) {
  if (!cacheConfig.metadataEnabled) return;
  await loadStore();
  records.delete(key);
  scheduleSave();
}

export async function listPreviewRecordsOldest() {
  if (!cacheConfig.metadataEnabled) return [];
  await loadStore();
  return Array.from(records.values())
    .filter((record) => record.kind === 'preview' && record.previewPath)
    .sort((a, b) => Date.parse(a.lastAccessedAt || 0) - Date.parse(b.lastAccessedAt || 0));
}

export async function flushStore() {
  if (!cacheConfig.metadataEnabled) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await writeStore();
}

async function loadStore() {
  if (loaded) return;
  loaded = true;

  try {
    const raw = await fs.readFile(cacheConfig.metadataPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.records)) return;

    for (const record of parsed.records) {
      if (record?.key) records.set(record.key, record);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Cache metadata ignored: ${error.message}`);
    }
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    savePromise = savePromise.then(writeStore).catch((error) => {
      console.warn(`Cache metadata save failed: ${error.message}`);
    });
  }, 250);
}

async function writeStore() {
  await fs.mkdir(path.dirname(cacheConfig.metadataPath), { recursive: true });
  const temporaryPath = `${cacheConfig.metadataPath}.${process.pid}.tmp`;
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    records: Array.from(records.values())
  };

  await fs.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.rename(temporaryPath, cacheConfig.metadataPath);
}
