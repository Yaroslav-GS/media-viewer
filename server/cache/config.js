import os from 'node:os';
import path from 'node:path';

const defaultCacheRoot = path.join(os.tmpdir(), 'local-media-viewer-cache');
const cacheRootDir = path.resolve(process.env.CACHE_DIR || defaultCacheRoot);

export const cacheConfig = {
  rootDir: cacheRootDir,
  previewDir: path.resolve(process.env.PREVIEW_CACHE_DIR || path.join(cacheRootDir, 'previews')),
  metadataPath: path.resolve(process.env.CACHE_METADATA_PATH || path.join(cacheRootDir, 'metadata.json')),
  version: process.env.CACHE_VERSION || '1',
  maxBytes: readBytes(process.env.CACHE_MAX_BYTES, 1024 * 1024 * 1024),
  previewSizes: readPreviewSizes(process.env.THUMB_SIZES, [240, 480, 720]),
  defaultPreviewSize: readPositiveInt(process.env.THUMB_DEFAULT_SIZE, 480),
  imageFormat: readChoice(process.env.THUMB_FORMAT, ['webp'], 'webp'),
  imageQuality: readPositiveInt(process.env.THUMB_QUALITY, 68),
  imageEffort: readPositiveInt(process.env.THUMB_EFFORT, 4),
  videoQuality: readPositiveInt(process.env.VIDEO_THUMB_QUALITY, 72),
  videoThumbnailSeconds: readPositiveNumber(process.env.VIDEO_THUMB_SECONDS, 1),
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  concurrency: readPositiveInt(process.env.THUMB_CONCURRENCY, 2),
  metadataEnabled: readBoolean(process.env.METADATA_CACHE_ENABLED, true),
  videoThumbnailsEnabled: readBoolean(process.env.VIDEO_THUMBNAILS, true),
  cleanupIntervalMs: readPositiveInt(process.env.CACHE_CLEANUP_INTERVAL_MINUTES, 30) * 60 * 1000
};

export function readPreviewSize(input) {
  const value = Number.parseInt(Array.isArray(input) ? input[0] : input, 10);
  if (cacheConfig.previewSizes.has(value)) return value;
  return cacheConfig.defaultPreviewSize;
}

function readPositiveInt(input, fallback) {
  const value = Number.parseInt(input, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readPositiveNumber(input, fallback) {
  const value = Number.parseFloat(input);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readBytes(input, fallback) {
  const value = Number.parseInt(input, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readBoolean(input, fallback) {
  if (input === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(input).trim().toLowerCase());
}

function readChoice(input, choices, fallback) {
  return choices.includes(input) ? input : fallback;
}

function readPreviewSizes(input, fallback) {
  const values = String(input || '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  return new Set(values.length ? values : fallback);
}
