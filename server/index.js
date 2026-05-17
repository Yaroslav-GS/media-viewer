import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearFailedLogins,
  createSession,
  destroySession,
  isLoginLimited,
  recordFailedLogin,
  requireCsrfToken,
  requireAuth,
  validatePinConfig,
  verifyPin
} from './auth.js';
import {
  buildFolderTree,
  cleanupUploadedFiles,
  createFolder,
  deleteFolder,
  deleteMediaFile,
  getMediaRoot,
  listMedia,
  moveFolder,
  moveMediaFile,
  saveUploadedMedia,
  sendMediaFile,
  sendMediaPreviewFile
} from './media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);
const maxUploadFiles = readPositiveInt(process.env.MAX_UPLOAD_FILES, 200);
const maxUploadFileBytes = readPositiveInt(process.env.MAX_UPLOAD_FILE_MB, 250) * 1024 * 1024;
const apiRateLimitWindowMs = readPositiveInt(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000);
const apiRateLimitMaxRequests = readPositiveInt(process.env.API_RATE_LIMIT_MAX_REQUESTS, 120);
const uploadTempDir = path.resolve(process.env.UPLOAD_TMP_DIR || path.join(os.tmpdir(), 'local-media-viewer-uploads'));
const apiRateLimit = rateLimit({
  windowMs: apiRateLimitWindowMs,
  limit: apiRateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' }
});
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      fs.mkdir(uploadTempDir, { recursive: true })
        .then(() => callback(null, uploadTempDir))
        .catch((error) => callback(error));
    }
  }),
  limits: {
    files: maxUploadFiles,
    fileSize: maxUploadFileBytes
  }
});

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(requireTrustedOrigin);
app.use(express.json({ limit: '128kb' }));
app.use(cookieParser());
app.use('/api', apiRateLimit);
app.use('/api', requireCsrfToken);

app.post('/api/login', (req, res) => {
  const configuredPin = process.env.PIN_CODE;
  const loginKey = req.ip || req.socket.remoteAddress || 'unknown';

  if (!validatePinConfig(configuredPin)) {
    return res.status(500).json({ error: 'PIN_CODE должен содержать только 4-16 цифр' });
  }

  if (isLoginLimited(loginKey)) {
    return res.status(429).json({ error: 'Слишком много попыток входа. Попробуйте позже.' });
  }

  if (!verifyPin(req.body?.pin, configuredPin)) {
    recordFailedLogin(loginKey);
    return res.status(401).json({ error: 'Неверный пинкод' });
  }

  clearFailedLogins(loginKey);
  const csrfToken = createSession(req, res);
  return res.json({ ok: true, csrfToken });
});

app.post('/api/logout', requireAuth, (req, res) => {
  destroySession(req, res);
  return res.json({ ok: true });
});

app.get('/api/tree', requireAuth, asyncHandler(async (req, res) => {
  const mediaRoot = await getRequestMediaRoot();
  const children = await buildFolderTree(mediaRoot);
  res.json({ name: 'MEDIA_ROOT', path: '/', children });
}));

app.get('/api/media', requireAuth, asyncHandler(async (req, res) => {
  const mediaRoot = await getRequestMediaRoot();
  const items = await listMedia(mediaRoot, req.query.path || '/');
  res.json({ items });
}));

app.post('/api/upload', requireAuth, upload.array('files'), asyncHandler(async (req, res) => {
  let result;
  try {
    const mediaRoot = await getRequestMediaRoot();
    const relativePaths = parseRelativePaths(req.body.paths);
    result = await saveUploadedMedia(mediaRoot, req.query.path || '/', req.files || [], relativePaths);
  } finally {
    await cleanupUploadedFiles(req.files || []);
  }

  if (!result.saved.length && result.skipped.length) {
    return res.status(400).json({
      error: 'Нет поддерживаемых файлов для загрузки',
      ...result
    });
  }

  return res.json(result);
}));

app.post('/api/move-file', requireAuth, asyncHandler(async (req, res) => {
  const mediaRoot = await getRequestMediaRoot();
  const result = await moveMediaFile(mediaRoot, req.body?.from, req.body?.toDir);
  return res.json(result);
}));

app.post('/api/move-folder', requireAuth, asyncHandler(async (req, res) => {
  const mediaRoot = await getRequestMediaRoot();
  const result = await moveFolder(mediaRoot, req.body?.from, req.body?.toDir);
  return res.json(result);
}));

app.post('/api/folder', requireAuth, asyncHandler(async (req, res) => {
  const mediaRoot = await getRequestMediaRoot();
  const result = await createFolder(mediaRoot, req.body?.parentPath || '/', req.body?.name || 'New folder');
  return res.json(result);
}));

app.delete('/api/media', requireAuth, asyncHandler(async (req, res) => {
  const mediaRoot = await getRequestMediaRoot();
  await deleteMediaFile(mediaRoot, req.body?.path);
  return res.json({ ok: true });
}));

app.delete('/api/folder', requireAuth, asyncHandler(async (req, res) => {
  const mediaRoot = await getRequestMediaRoot();
  await deleteFolder(mediaRoot, req.body?.path);
  return res.json({ ok: true });
}));

app.get('/media/*', requireAuth, asyncHandler(async (req, res) => {
  const mediaRoot = await getRequestMediaRoot();
  await sendMediaFile(req, res, mediaRoot, `/${req.params[0] || ''}`);
}));

app.get('/preview/*', requireAuth, asyncHandler(async (req, res) => {
  const mediaRoot = await getRequestMediaRoot();
  await sendMediaPreviewFile(req, res, mediaRoot, `/${req.params[0] || ''}`);
}));

app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/media') || req.originalUrl.startsWith('/preview')) {
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

  if (error instanceof multer.MulterError) {
    return res.status(413).json({ error: uploadErrorMessage(error) });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Тело запроса слишком большое' });
  }

  const statusCode = error.statusCode || 500;
  return res.status(statusCode).json({ error: error.message || 'Ошибка сервера' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Local Media Viewer: http://localhost:${port}`);
});

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  );
  next();
}

function requireTrustedOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.originalUrl.startsWith('/api/')) return next();

  const source = req.headers.origin || req.headers.referer;
  if (!source || isTrustedSource(source, req)) return next();

  return res.status(403).json({ error: 'Источник запроса не разрешён' });
}

function isTrustedSource(source, req) {
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    return false;
  }

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.includes(parsed.origin)) return true;

  const host = req.headers.host || '';
  const requestProtocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
  if (parsed.host === host && parsed.protocol === requestProtocol) return true;

  const isLocalhostDev = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  return process.env.NODE_ENV !== 'production' && isLocalhostDev;
}

function getRequestMediaRoot() {
  return getMediaRoot(process.env.MEDIA_ROOT);
}

function parseRelativePaths(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function uploadErrorMessage(error) {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return `Файл слишком большой. Лимит: ${Math.round(maxUploadFileBytes / 1024 / 1024)} МБ`;
  }
  if (error.code === 'LIMIT_FILE_COUNT') {
    return `Слишком много файлов. Лимит: ${maxUploadFiles}`;
  }
  return 'Загрузка отклонена';
}
