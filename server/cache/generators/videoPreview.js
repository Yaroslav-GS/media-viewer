import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { cacheConfig } from '../config.js';

let ffmpegAvailable;
let ffmpegMissingWarningShown = false;

export async function createVideoPreview(sourcePath, destinationPath, size) {
  if (cacheConfig.videoThumbnailsEnabled) {
    try {
      await ensureFfmpegAvailable();
      await createVideoFramePreview(sourcePath, destinationPath, size);
      return;
    } catch (error) {
      warnVideoPreviewFallback(sourcePath, error);
      throw error;
    }
  }

  await createVideoPlaceholder(destinationPath, size);
}

async function ensureFfmpegAvailable() {
  if (!ffmpegAvailable) {
    ffmpegAvailable = runFfmpeg(['-version']);
  }

  return ffmpegAvailable;
}

async function createVideoFramePreview(sourcePath, destinationPath, size) {
  const filter = [
    `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
    'setsar=1'
  ].join(',');
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    formatTimestamp(cacheConfig.videoThumbnailSeconds),
    '-i',
    sourcePath,
    '-frames:v',
    '1',
    '-vf',
    filter,
    '-q:v',
    qualityToFfmpegQscale(cacheConfig.videoQuality),
    '-y',
    destinationPath
  ];

  await runFfmpeg(args);
  const stats = await fs.stat(destinationPath);
  if (stats.size === 0) {
    throw new Error('ffmpeg created an empty video frame preview');
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cacheConfig.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('ffmpeg timed out while creating a video frame preview'));
    }, 30000);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

function warnVideoPreviewFallback(sourcePath, error) {
  const isMissingFfmpeg = error.code === 'ENOENT' || error.message.includes('ENOENT');
  if (isMissingFfmpeg) {
    if (ffmpegMissingWarningShown) return;
    ffmpegMissingWarningShown = true;
    console.warn(
      `Video frame previews are disabled because ffmpeg was not found at "${cacheConfig.ffmpegPath}". ` +
      'Install ffmpeg or set FFMPEG_PATH.'
    );
    return;
  }

  console.warn(`Could not generate video frame preview for ${sourcePath}: ${error.message}`);
}

function formatTimestamp(seconds) {
  return Math.max(0, seconds).toFixed(3);
}

function qualityToFfmpegQscale(quality) {
  const clamped = Math.min(100, Math.max(1, quality));
  return String(Math.round(31 - (clamped / 100) * 29));
}

async function createVideoPlaceholder(destinationPath, size) {
  const width = size;
  const height = Math.round(size * 0.5625);
  const radius = Math.round(size * 0.12);
  const triangleSize = Math.round(size * 0.12);
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#11151a"/>
      <rect x="0" y="0" width="${width}" height="${height}" fill="#202833" opacity="0.55"/>
      <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="#000" opacity="0.55"/>
      <polygon points="${centerX - triangleSize / 2},${centerY - triangleSize} ${centerX - triangleSize / 2},${centerY + triangleSize} ${centerX + triangleSize},${centerY}" fill="#fff"/>
    </svg>
  `;

  await sharp(Buffer.from(svg)).jpeg({ quality: cacheConfig.videoQuality }).toFile(destinationPath);
}
