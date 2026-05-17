import crypto from 'node:crypto';

const sessions = new Map();
const loginAttempts = new Map();
const SESSION_COOKIE = 'media_viewer_session';
const SESSION_TTL_MS = readPositiveInt(process.env.SESSION_TTL_MINUTES, 12 * 60) * 60 * 1000;
const LOGIN_WINDOW_MS = readPositiveInt(process.env.LOGIN_WINDOW_MINUTES, 10) * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = readPositiveInt(process.env.LOGIN_MAX_ATTEMPTS, 8);
const CSRF_HEADER = 'x-csrf-token';

export function validatePinConfig(pin) {
  return typeof pin === 'string' && /^\d{4,16}$/.test(pin);
}

export function verifyPin(inputPin, configuredPin) {
  if (!validatePinConfig(configuredPin)) return false;

  const input = Buffer.from(String(inputPin || ''));
  const expected = Buffer.from(configuredPin);
  if (input.length !== expected.length) return false;

  return crypto.timingSafeEqual(input, expected);
}

export function isLoginLimited(key) {
  const attempt = loginAttempts.get(key);
  if (!attempt) return false;

  if (attempt.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return false;
  }

  return attempt.count >= LOGIN_MAX_ATTEMPTS;
}

export function recordFailedLogin(key) {
  const now = Date.now();
  const attempt = loginAttempts.get(key);

  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }

  attempt.count += 1;
}

export function clearFailedLogins(key) {
  loginAttempts.delete(key);
}

export function createSession(req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS, csrfToken });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    path: '/'
  });
  return csrfToken;
}

export function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    sessions.delete(token);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function isAuthorized(req) {
  const session = getSession(req);
  if (!session) return false;

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

export function requireAuth(req, res, next) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  return next();
}

export function requireCsrfToken(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/login') return next();

  const session = getSession(req);
  const providedToken = req.get(CSRF_HEADER);
  if (!session || typeof providedToken !== 'string' || !safeTokenEquals(providedToken, session.csrfToken)) {
    return res.status(403).json({ error: 'Недействительный CSRF-токен' });
  }

  return next();
}

function getSession(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

function safeTokenEquals(inputToken, expectedToken) {
  const input = Buffer.from(inputToken);
  const expected = Buffer.from(expectedToken);
  if (input.length !== expected.length) return false;
  return crypto.timingSafeEqual(input, expected);
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
