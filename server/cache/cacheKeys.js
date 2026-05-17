import crypto from 'node:crypto';
import path from 'node:path';
import { cacheConfig } from './config.js';

export function previewExtensionFor(type) {
  return type === 'image' ? cacheConfig.imageFormat : 'jpg';
}

export function previewFormatFor(type) {
  return type === 'image' ? cacheConfig.imageFormat : 'jpeg';
}

function previewGeneratorFor(type) {
  if (type === 'image') return 'sharp-image';
  return cacheConfig.videoThumbnailsEnabled ? 'ffmpeg-frame-v2' : 'video-placeholder';
}

export function buildPreviewCacheKey({ sourcePath, stats, type, size }) {
  return crypto
    .createHash('sha256')
    .update(
      [
        'preview',
        cacheConfig.version,
        sourcePath,
        stats.size,
        stats.mtimeMs,
        type,
        size,
        previewFormatFor(type),
        previewGeneratorFor(type)
      ].join('\0')
    )
    .digest('hex');
}

export function buildPreviewPath(cacheKey, type) {
  return path.join(cacheConfig.previewDir, `${cacheKey}.${previewExtensionFor(type)}`);
}

export function buildPreviewFingerprint({ sourcePath, stats, type, size }) {
  return {
    cacheVersion: cacheConfig.version,
    sourcePath,
    fileSize: stats.size,
    mtimeMs: stats.mtimeMs,
    mediaType: type,
    previewSize: size,
    previewFormat: previewFormatFor(type),
    previewGenerator: previewGeneratorFor(type)
  };
}
