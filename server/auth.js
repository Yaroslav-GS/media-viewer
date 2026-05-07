import crypto from 'node:crypto';

const sessions = new Set();
const SESSION_COOKIE = 'media_viewer_session';

export function validatePinConfig(pin) {
  return typeof pin === 'string' && /^\d{4,16}$/.test(pin);
}

export function createSession(res) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.add(token);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: '/'
  });
}

export function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    sessions.delete(token);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function isAuthorized(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  return Boolean(token && sessions.has(token));
}

export function requireAuth(req, res, next) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  return next();
}
