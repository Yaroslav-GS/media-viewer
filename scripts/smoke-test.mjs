const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const pinCode = process.env.SMOKE_PIN_CODE || process.env.PIN_CODE || '1234';

await waitForServer();
await assertRootPage();
const { cookie, csrfToken } = await login();
await assertTree(cookie);
await assertCsrfProtection(cookie, csrfToken);

console.log('Smoke test passed');

async function waitForServer() {
  const deadline = Date.now() + readPositiveInt(process.env.SMOKE_TIMEOUT_MS, 30000);
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
      lastError = new Error(`GET / returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Server did not become ready at ${baseUrl}: ${lastError?.message || 'timeout'}`);
}

async function assertRootPage() {
  const response = await fetch(baseUrl);
  assertStatus(response, 200, 'GET /');

  const body = await response.text();
  if (!body.includes('<div id="root">')) {
    throw new Error('GET / did not return the built app shell');
  }
}

async function login() {
  const csrfResponse = await fetch(`${baseUrl}/api/csrf-token`);
  assertStatus(csrfResponse, 200, 'GET /api/csrf-token');

  const csrfCookie = readSetCookies(csrfResponse)[0];
  if (!csrfCookie) {
    throw new Error('GET /api/csrf-token did not set a CSRF cookie');
  }

  const csrfBody = await csrfResponse.json();
  if (typeof csrfBody.csrfToken !== 'string' || !csrfBody.csrfToken) {
    throw new Error('GET /api/csrf-token did not return a CSRF token');
  }

  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: {
      Cookie: csrfCookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfBody.csrfToken
    },
    body: JSON.stringify({ pin: pinCode })
  });
  assertStatus(response, 200, 'POST /api/login');

  const sessionCookie = readSetCookies(response).find((cookie) => cookie.startsWith('media_viewer_session='));
  if (!sessionCookie) {
    throw new Error('POST /api/login did not set a session cookie');
  }

  const body = await response.json();
  if (typeof body.csrfToken !== 'string' || !body.csrfToken) {
    throw new Error('POST /api/login did not return a CSRF token');
  }

  return { cookie: `${csrfCookie}; ${sessionCookie}`, csrfToken: body.csrfToken };
}

async function assertTree(cookie) {
  const response = await fetch(`${baseUrl}/api/tree`, {
    headers: { Cookie: cookie }
  });
  assertStatus(response, 200, 'GET /api/tree');

  const body = await response.json();
  if (body.path !== '/' || !Array.isArray(body.children)) {
    throw new Error('GET /api/tree returned an unexpected payload');
  }
}

async function assertCsrfProtection(cookie, csrfToken) {
  const rejectedResponse = await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  assertStatus(rejectedResponse, 403, 'POST /api/logout without CSRF token');

  const acceptedResponse = await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrfToken
    }
  });
  assertStatus(acceptedResponse, 200, 'POST /api/logout with CSRF token');
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label} returned ${response.status}, expected ${expected}`);
  }
}

function readSetCookies(response) {
  const setCookies = response.headers.getSetCookie?.() || [];
  if (setCookies.length) {
    return setCookies.map((cookie) => cookie.split(';')[0]);
  }

  const header = response.headers.get('set-cookie');
  return header ? [header.split(';')[0]] : [];
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
