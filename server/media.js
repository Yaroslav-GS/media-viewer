import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

export const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);
export const videoExtensions = new Set(['.mp4', '.webm', '.mov', '.m4v']);

const mimeTypes = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v'
};

export function mediaTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (imageExtensions.has(ext)) return 'image';
  if (videoExtensions.has(ext)) return 'video';
  return null;
}

export async function getMediaRoot(rawRoot) {
  if (!rawRoot) {
    const error = new Error('MEDIA_ROOT не задан');
    error.statusCode = 500;
    throw error;
  }

  const root = path.resolve(rawRoot);
  let stats;

  try {
    stats = await fs.stat(root);
  } catch {
    const error = new Error('Директория MEDIA_ROOT недоступна');
    error.statusCode = 500;
    throw error;
  }

  if (!stats.isDirectory()) {
    const error = new Error('MEDIA_ROOT должен быть директорией');
    error.statusCode = 500;
    throw error;
  }

  return await fs.realpath(root);
}

export function resolveInsideRoot(mediaRoot, relativePath = '') {
  const cleanRelativePath = normalizeClientPath(relativePath);
  const targetPath = path.resolve(mediaRoot, `.${cleanRelativePath}`);
  const relation = path.relative(mediaRoot, targetPath);

  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    const error = new Error('Недопустимый путь');
    error.statusCode = 400;
    throw error;
  }

  return { absolutePath: targetPath, relativePath: cleanRelativePath };
}

export function normalizeClientPath(input = '') {
  const value = Array.isArray(input) ? input[0] : String(input || '');
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  const normalized = path.posix.normalize(withLeadingSlash.replaceAll('\\', '/'));
  return normalized === '/' ? '/' : normalized.replace(/\/+$/, '');
}

export async function buildFolderTree(mediaRoot, relativePath = '/') {
  const { absolutePath, relativePath: currentRelativePath } = resolveInsideRoot(mediaRoot, relativePath);
  const entries = await safeReadDir(absolutePath);
  const directories = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const childRelativePath = path.posix.join(currentRelativePath, entry.name);
    directories.push({
      name: entry.name,
      path: childRelativePath.startsWith('/') ? childRelativePath : `/${childRelativePath}`,
      children: await buildFolderTree(mediaRoot, childRelativePath)
    });
  }

  directories.sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));
  return directories;
}

export async function listMedia(mediaRoot, relativePath = '/') {
  const { absolutePath } = resolveInsideRoot(mediaRoot, relativePath);
  const entries = await safeReadDir(absolutePath);
  const items = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const type = mediaTypeFor(entry.name);
    if (!type) continue;

    const absoluteFilePath = path.join(absolutePath, entry.name);
    const stats = await fs.stat(absoluteFilePath);
    const fileRelativePath = path.posix.join(normalizeClientPath(relativePath), entry.name);
    const normalizedFilePath = fileRelativePath.startsWith('/') ? fileRelativePath : `/${fileRelativePath}`;

    items.push({
      name: entry.name,
      path: normalizedFilePath,
      type,
      url: `/media${encodeMediaPath(normalizedFilePath)}`,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));
  return items;
}

export async function sendMediaFile(req, res, mediaRoot, mediaPath) {
  const { absolutePath } = resolveInsideRoot(mediaRoot, mediaPath);
  const type = mediaTypeFor(absolutePath);

  if (!type) {
    return res.status(404).json({ error: 'Файл не поддерживается' });
  }

  let stats;
  try {
    stats = await fs.stat(absolutePath);
  } catch {
    return res.status(404).json({ error: 'Файл не найден' });
  }

  const realFilePath = await fs.realpath(absolutePath);
  const relation = path.relative(mediaRoot, realFilePath);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    return res.status(403).json({ error: 'Файл вне MEDIA_ROOT недоступен' });
  }

  if (!stats.isFile()) {
    return res.status(404).json({ error: 'Файл не найден' });
  }

  const contentType = mimeTypes[path.extname(absolutePath).toLowerCase()] || 'application/octet-stream';
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);

  const range = req.headers.range;
  if (type === 'video' && range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      return res.status(416).end();
    }

    const start = match[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match[2] ? Number.parseInt(match[2], 10) : stats.size - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stats.size) {
      res.setHeader('Content-Range', `bytes */${stats.size}`);
      return res.status(416).end();
    }

    const safeEnd = Math.min(end, stats.size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${safeEnd}/${stats.size}`);
    res.setHeader('Content-Length', safeEnd - start + 1);
    return createReadStream(realFilePath, { start, end: safeEnd }).pipe(res);
  }

  res.setHeader('Content-Length', stats.size);
  return createReadStream(realFilePath).pipe(res);
}

export async function saveUploadedMedia(mediaRoot, targetRelativePath, files, relativePaths = []) {
  const { absolutePath: targetDir } = resolveInsideRoot(mediaRoot, targetRelativePath);
  await assertExistingDirectoryInsideRoot(mediaRoot, targetDir);

  const topFolderMap = new Map();
  const saved = [];
  const skipped = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const uploadPath = relativePaths[index] || file.originalname;
    const segments = safeUploadSegments(uploadPath || file.originalname);
    const fileName = segments.at(-1) || file.originalname;

    if (!mediaTypeFor(fileName)) {
      skipped.push({ name: fileName, reason: 'Файл не поддерживается' });
      continue;
    }

    let destinationSegments = segments;
    if (segments.length > 1) {
      const topFolder = segments[0];
      if (!topFolderMap.has(topFolder)) {
        const uniqueTopFolder = await uniqueName(targetDir, topFolder);
        topFolderMap.set(topFolder, uniqueTopFolder);
        await ensureDirectoryPathInsideRoot(mediaRoot, targetDir, [uniqueTopFolder]);
      }
      destinationSegments = [topFolderMap.get(topFolder), ...segments.slice(1)];
    }

    const parentSegments = destinationSegments.slice(0, -1);
    const destinationDir = await ensureDirectoryPathInsideRoot(mediaRoot, targetDir, parentSegments);

    const uniqueFileName = await uniqueName(destinationDir, fileName);
    const destinationPath = path.join(destinationDir, uniqueFileName);
    await fs.writeFile(destinationPath, file.buffer, { flag: 'wx' });
    saved.push({
      name: uniqueFileName,
      path: toClientPath(mediaRoot, destinationPath)
    });
  }

  return { saved, skipped };
}

export async function createFolder(mediaRoot, parentRelativePath, requestedName = 'New folder') {
  const { absolutePath: parentDir } = resolveInsideRoot(mediaRoot, parentRelativePath);
  const realParentDir = await assertExistingDirectoryInsideRoot(mediaRoot, parentDir);
  const folderName = sanitizeFolderName(requestedName);
  const destinationName = await uniqueName(realParentDir, folderName);
  const destinationPath = path.join(realParentDir, destinationName);

  await fs.mkdir(destinationPath);
  await assertExistingDirectoryInsideRoot(mediaRoot, destinationPath);

  return {
    name: destinationName,
    path: toClientPath(mediaRoot, destinationPath)
  };
}

export async function moveMediaFile(mediaRoot, fromRelativePath, toDirectoryRelativePath) {
  const { absolutePath: sourcePath } = resolveInsideRoot(mediaRoot, fromRelativePath);
  const { absolutePath: targetDir } = resolveInsideRoot(mediaRoot, toDirectoryRelativePath);
  const realSourcePath = await assertExistingFileInsideRoot(mediaRoot, sourcePath);
  const realTargetDir = await assertExistingDirectoryInsideRoot(mediaRoot, targetDir);

  if (path.dirname(realSourcePath) === realTargetDir) {
    const error = new Error('Файл уже находится в этой папке');
    error.statusCode = 400;
    throw error;
  }

  if (!mediaTypeFor(realSourcePath)) {
    const error = new Error('Файл не поддерживается');
    error.statusCode = 400;
    throw error;
  }

  const destinationName = await uniqueName(realTargetDir, path.basename(realSourcePath));
  const destinationPath = path.join(realTargetDir, destinationName);
  await fs.rename(realSourcePath, destinationPath);

  return {
    name: destinationName,
    path: toClientPath(mediaRoot, destinationPath)
  };
}

export async function moveFolder(mediaRoot, fromRelativePath, toDirectoryRelativePath) {
  const { absolutePath: sourcePath, relativePath: sourceRelativePath } = resolveInsideRoot(mediaRoot, fromRelativePath);
  const { absolutePath: targetDir } = resolveInsideRoot(mediaRoot, toDirectoryRelativePath);

  if (sourceRelativePath === '/') {
    const error = new Error('Корневую папку перемещать нельзя');
    error.statusCode = 400;
    throw error;
  }

  const realSourcePath = await assertExistingDirectoryInsideRoot(mediaRoot, sourcePath);
  const realTargetDir = await assertExistingDirectoryInsideRoot(mediaRoot, targetDir);
  const relation = path.relative(realSourcePath, realTargetDir);

  if (path.dirname(realSourcePath) === realTargetDir) {
    const error = new Error('Папка уже находится в этой папке');
    error.statusCode = 400;
    throw error;
  }

  if (relation === '' || (!relation.startsWith('..') && !path.isAbsolute(relation))) {
    const error = new Error('Нельзя переместить папку внутрь самой себя');
    error.statusCode = 400;
    throw error;
  }

  const destinationName = await uniqueName(realTargetDir, path.basename(realSourcePath));
  const destinationPath = path.join(realTargetDir, destinationName);
  await fs.rename(realSourcePath, destinationPath);

  return {
    name: destinationName,
    path: toClientPath(mediaRoot, destinationPath)
  };
}

export async function deleteMediaFile(mediaRoot, relativePath) {
  const { absolutePath } = resolveInsideRoot(mediaRoot, relativePath);
  await assertExistingFileInsideRoot(mediaRoot, absolutePath);

  if (!mediaTypeFor(absolutePath)) {
    const error = new Error('Файл не поддерживается');
    error.statusCode = 400;
    throw error;
  }

  await fs.unlink(absolutePath);
}

export async function deleteFolder(mediaRoot, relativePath) {
  const { absolutePath, relativePath: normalizedRelativePath } = resolveInsideRoot(mediaRoot, relativePath);
  if (normalizedRelativePath === '/') {
    const error = new Error('Корневую папку удалить нельзя');
    error.statusCode = 400;
    throw error;
  }

  await assertExistingDirectoryInsideRoot(mediaRoot, absolutePath);
  await fs.rm(absolutePath, { recursive: true });
}

async function safeReadDir(absolutePath) {
  try {
    return await fs.readdir(absolutePath, { withFileTypes: true });
  } catch {
    const error = new Error('Директория недоступна');
    error.statusCode = 500;
    throw error;
  }
}

async function assertExistingDirectoryInsideRoot(mediaRoot, absolutePath) {
  const realPath = await assertInsideRoot(mediaRoot, absolutePath);
  const stats = await fs.stat(realPath);
  if (!stats.isDirectory()) {
    const error = new Error('Директория недоступна');
    error.statusCode = 400;
    throw error;
  }
  return realPath;
}

async function assertExistingFileInsideRoot(mediaRoot, absolutePath) {
  const realPath = await assertInsideRoot(mediaRoot, absolutePath);
  const stats = await fs.stat(realPath);
  if (!stats.isFile()) {
    const error = new Error('Файл недоступен');
    error.statusCode = 400;
    throw error;
  }
  return realPath;
}

async function assertInsideRoot(mediaRoot, absolutePath) {
  let realPath;
  try {
    realPath = await fs.realpath(absolutePath);
  } catch {
    const error = new Error('Файл или папка недоступны');
    error.statusCode = 404;
    throw error;
  }
  assertRealPathInsideRoot(mediaRoot, realPath);
  return realPath;
}

async function ensureDirectoryPathInsideRoot(mediaRoot, baseDir, segments) {
  let currentDir = await assertExistingDirectoryInsideRoot(mediaRoot, baseDir);

  for (const segment of segments) {
    currentDir = path.join(currentDir, segment);
    if (await exists(currentDir)) {
      await assertExistingDirectoryInsideRoot(mediaRoot, currentDir);
    } else {
      await fs.mkdir(currentDir);
      await assertExistingDirectoryInsideRoot(mediaRoot, currentDir);
    }
  }

  return currentDir;
}

function assertRealPathInsideRoot(mediaRoot, realPath) {
  const relation = path.relative(mediaRoot, realPath);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    const error = new Error('Попытка выйти за пределы хранилища');
    error.statusCode = 403;
    throw error;
  }
}

function safeUploadSegments(uploadPath) {
  const segments = String(uploadPath || '')
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
    const error = new Error('Недопустимый путь загрузки');
    error.statusCode = 400;
    throw error;
  }

  return segments;
}

function sanitizeFolderName(name) {
  const value = String(name || '').trim();
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || value.includes('\0')) {
    const error = new Error('Недопустимое имя папки');
    error.statusCode = 400;
    throw error;
  }
  return value;
}

async function uniqueName(parentDir, requestedName) {
  const parsed = path.parse(requestedName);
  let candidate = requestedName;
  let counter = 1;

  while (await exists(path.join(parentDir, candidate))) {
    candidate = parsed.ext
      ? `${parsed.name} (${counter})${parsed.ext}`
      : `${requestedName} (${counter})`;
    counter += 1;
  }

  return candidate;
}

async function exists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function toClientPath(mediaRoot, absolutePath) {
  return `/${path.relative(mediaRoot, absolutePath).split(path.sep).join('/')}`;
}

function encodeMediaPath(relativePath) {
  return normalizeClientPath(relativePath)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}
