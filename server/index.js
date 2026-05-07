import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, destroySession, requireAuth, validatePinConfig } from './auth.js';
import {
  buildFolderTree,
  createFolder,
  deleteFolder,
  deleteMediaFile,
  getMediaRoot,
  listMedia,
  moveFolder,
  moveMediaFile,
  saveUploadedMedia,
  sendMediaFile
} from './media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1000,
    fileSize: 1024 * 1024 * 1024
  }
});

app.use(express.json());
app.use(cookieParser());

app.post('/api/login', (req, res) => {
  const configuredPin = process.env.PIN_CODE;

  if (!validatePinConfig(configuredPin)) {
    return res.status(500).json({ error: 'PIN_CODE должен содержать только 4-16 цифр' });
  }

  if (String(req.body?.pin || '') !== configuredPin) {
    return res.status(401).json({ error: 'Неверный пинкод' });
  }

  createSession(res);
  return res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  destroySession(req, res);
  return res.json({ ok: true });
});

app.get('/api/tree', requireAuth, async (req, res, next) => {
  try {
    const mediaRoot = await getMediaRoot(process.env.MEDIA_ROOT);
    const children = await buildFolderTree(mediaRoot);
    res.json({ name: 'MEDIA_ROOT', path: '/', children });
  } catch (error) {
    next(error);
  }
});

app.get('/api/media', requireAuth, async (req, res, next) => {
  try {
    const mediaRoot = await getMediaRoot(process.env.MEDIA_ROOT);
    const items = await listMedia(mediaRoot, req.query.path || '/');
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.post('/api/upload', requireAuth, upload.array('files'), async (req, res, next) => {
  try {
    const mediaRoot = await getMediaRoot(process.env.MEDIA_ROOT);
    const relativePaths = parseRelativePaths(req.body.paths);
    const result = await saveUploadedMedia(mediaRoot, req.query.path || '/', req.files || [], relativePaths);

    if (!result.saved.length && result.skipped.length) {
      return res.status(400).json({
        error: 'Нет поддерживаемых файлов для загрузки',
        ...result
      });
    }

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/move-file', requireAuth, async (req, res, next) => {
  try {
    const mediaRoot = await getMediaRoot(process.env.MEDIA_ROOT);
    const result = await moveMediaFile(mediaRoot, req.body?.from, req.body?.toDir);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/move-folder', requireAuth, async (req, res, next) => {
  try {
    const mediaRoot = await getMediaRoot(process.env.MEDIA_ROOT);
    const result = await moveFolder(mediaRoot, req.body?.from, req.body?.toDir);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/folder', requireAuth, async (req, res, next) => {
  try {
    const mediaRoot = await getMediaRoot(process.env.MEDIA_ROOT);
    const result = await createFolder(mediaRoot, req.body?.parentPath || '/', req.body?.name || 'New folder');
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/media', requireAuth, async (req, res, next) => {
  try {
    const mediaRoot = await getMediaRoot(process.env.MEDIA_ROOT);
    await deleteMediaFile(mediaRoot, req.body?.path);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/folder', requireAuth, async (req, res, next) => {
  try {
    const mediaRoot = await getMediaRoot(process.env.MEDIA_ROOT);
    await deleteFolder(mediaRoot, req.body?.path);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.get('/media/*', requireAuth, async (req, res, next) => {
  try {
    const mediaRoot = await getMediaRoot(process.env.MEDIA_ROOT);
    await sendMediaFile(req, res, mediaRoot, `/${req.params[0] || ''}`);
  } catch (error) {
    next(error);
  }
});

app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/media')) {
    return res.status(404).json({ error: 'Файл не найден' });
  }

  return next();
});

const distDir = path.join(rootDir, 'dist');
app.use(express.static(distDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode = error.statusCode || 500;
  return res.status(statusCode).json({ error: error.message || 'Ошибка сервера' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Local Media Viewer: http://localhost:${port}`);
});

function parseRelativePaths(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}
