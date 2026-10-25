import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const projectDir = fileURLToPath(new URL('..', import.meta.url));
const execFileAsync = promisify(execFile);
const imagePath = '/Альбом, 100%/вложенная папка/фото #1.png';
const encodedImagePath = imagePath.split('/').map(encodeURIComponent).join('/');
let temporaryDir;
let runtimeDir;
let environment;
let app;
let baseUrl;
let cookie;
let csrfToken;
let originalImage;

describe('Express 5 server regressions', { timeout: 30_000 }, () => {
  before(async () => {
    // Copy the actual server and build into a hidden parent directory as well:
    // Express 5 sendFile must not treat the deployment root as a dotfile URL.
    await fs.access(path.join(projectDir, 'dist/index.html')).catch(() => {
      throw new Error('Build the app with npm run build before running regressions');
    });
    temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-viewer-regression-'));
    runtimeDir = path.join(temporaryDir, '.app');
    const mediaRoot = path.join(temporaryDir, 'media');
    const outsideRoot = path.join(temporaryDir, 'media-outside');
    await fs.mkdir(runtimeDir);
    await fs.cp(path.join(projectDir, 'server'), path.join(runtimeDir, 'server'), { recursive: true });
    await fs.cp(path.join(projectDir, 'dist'), path.join(runtimeDir, 'dist'), { recursive: true });
    await fs.copyFile(path.join(projectDir, 'package.json'), path.join(runtimeDir, 'package.json'));
    await fs.symlink(path.join(projectDir, 'node_modules'), path.join(runtimeDir, 'node_modules'), 'dir');
    await fs.mkdir(path.dirname(path.join(mediaRoot, imagePath)), { recursive: true });
    await fs.mkdir(outsideRoot);
    originalImage = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#437ac1' }
    }).png().toBuffer();
    await fs.writeFile(path.join(mediaRoot, imagePath), originalImage);
    await fs.writeFile(path.join(mediaRoot, 'root.png'), originalImage);
    // A literal percent-encoded name must survive exactly one decoding pass.
    await fs.mkdir(path.join(mediaRoot, '%2e%2e'));
    await fs.writeFile(path.join(mediaRoot, '%2e%2e/literal.png'), originalImage);
    await fs.writeFile(path.join(mediaRoot, 'clip.mp4'), '0123456789');
    await fs.writeFile(path.join(mediaRoot, 'notes.txt'), 'not media');
    await fs.mkdir(path.join(mediaRoot, 'directory.png'));
    await fs.writeFile(path.join(outsideRoot, 'secret.png'), originalImage);
    await fs.symlink(path.join(outsideRoot, 'secret.png'), path.join(mediaRoot, 'escape.png'));
    await fs.symlink(outsideRoot, path.join(mediaRoot, 'escape-dir'), 'dir');
    await fs.symlink(path.join(mediaRoot, 'root.png'), path.join(mediaRoot, 'inside.png'));
    environment = {
      ...process.env,
      NODE_ENV: 'test', PORT: '0', PIN_CODE: '1234', MEDIA_ROOT: mediaRoot,
      CACHE_DIR: path.join(temporaryDir, 'cache'),
      PREVIEW_CACHE_DIR: path.join(temporaryDir, 'cache/previews'),
      CACHE_METADATA_PATH: path.join(temporaryDir, 'cache/metadata.json'),
      UPLOAD_TMP_DIR: path.join(temporaryDir, 'uploads'),
      THUMB_SIZES: '240,480,720', THUMB_DEFAULT_SIZE: '480', THUMB_FORMAT: 'webp',
      API_RATE_LIMIT_MAX_REQUESTS: '1000', CONTENT_RATE_LIMIT_MAX_REQUESTS: '1200',
      CONTENT_RATE_LIMIT_WINDOW_MS: '60000', LOGIN_MAX_ATTEMPTS: '100', ALLOWED_ORIGINS: ''
    };
    app = spawnServer();
    baseUrl = await waitForStartup(app);
    const csrf = await request('/api/csrf-token');
    assert.equal(csrf.status, 200);
    const csrfCookie = csrf.headers['set-cookie'][0].split(';')[0];
    csrfToken = JSON.parse(csrf.body).csrfToken;
    const login = await request('/api/login', {
      method: 'POST',
      headers: { Cookie: csrfCookie, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234' })
    });
    assert.equal(login.status, 200);
    const sessionCookie = login.headers['set-cookie'].find((value) => value.startsWith('media_viewer_session='));
    assert.ok(sessionCookie);
    cookie = `${csrfCookie}; ${sessionCookie.split(';')[0]}`;
  });

  after(async () => {
    await stopServer(app);
    if (temporaryDir) await fs.rm(temporaryDir, { recursive: true, force: true });
  });

  test('starts the real server and serves the root and nested SPA routes', async () => {
    for (const url of ['/', '/album/nested', '/album%20name']) {
      const response = await request(url);
      assert.equal(response.status, 200, url);
      assert.match(response.headers['content-type'], /^text\/html/);
      assert.match(response.body.toString(), /<div id="root">/);
    }
    const assetName = (await fs.readdir(path.join(runtimeDir, 'dist/assets'))).find((name) => name.endsWith('.js'));
    assert.ok(assetName, 'Build must include a JavaScript asset');
    const asset = await request(`/assets/${assetName}`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers['content-type'], /^text\/javascript/);
    assert.ok(asset.body.length > 0);
  });

  test('requires authorization for originals and previews', async () => {
    for (const prefix of ['/media', '/preview']) {
      assert.equal((await request(`${prefix}${encodedImagePath}`)).status, 401);
    }
  });

  test('returns complete root and nested image files without corrupting their names', async () => {
    for (const url of [`/media${encodedImagePath}`, '/media/root.png', '/media/inside.png']) {
      const response = await authorizedRequest(url);
      assert.equal(response.status, 200, url);
      assert.equal(response.headers['content-type'], 'image/png');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.deepEqual(response.body, originalImage);
    }
    const head = await authorizedRequest(`/media${encodedImagePath}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers['content-length']), originalImage.length);
    assert.equal(head.body.length, 0);
  });

  test('generates and caches real previews, including the size query parameter', async () => {
    for (const url of [`/preview${encodedImagePath}?size=240`, '/preview/root.png?size=240']) {
      const response = await authorizedRequest(url);
      assert.equal(response.status, 200, url);
      assert.equal(response.headers['content-type'], 'image/webp');
      assert.match(response.headers['cache-control'], /^private,/);
      const metadata = await sharp(response.body).metadata();
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.width, 240);
      assert.equal(metadata.height, 180);
      assert.deepEqual((await authorizedRequest(url)).body, response.body);
    }
  });

  test('decodes wildcard parameters once and preserves literal percent names', async () => {
    for (const prefix of ['/media', '/preview']) {
      const response = await authorizedRequest(`${prefix}/%252e%252e/literal.png`);
      assert.equal(response.status, 200);
      if (prefix === '/media') assert.deepEqual(response.body, originalImage);
    }
  });

  test('preserves video streaming and range responses', async () => {
    const full = await authorizedRequest('/media/clip.mp4');
    assert.equal(full.status, 200);
    assert.equal(full.headers['content-type'], 'video/mp4');
    assert.equal(full.body.toString(), '0123456789');
    const range = await authorizedRequest('/media/clip.mp4', { headers: { Range: 'bytes=2-5' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers['content-range'], 'bytes 2-5/10');
    assert.equal(range.body.toString(), '2345');
    assert.equal((await authorizedRequest('/media/clip.mp4', { headers: { Range: 'bytes=100-' } })).status, 416);
  });

  test('keeps absent, unsupported and empty media URLs out of the SPA fallback', async () => {
    for (const prefix of ['/media', '/preview']) {
      for (const suffix of ['', '/', '/missing.png', '/notes.txt', '/directory.png']) {
        const response = await authorizedRequest(`${prefix}${suffix}`);
        assert.equal(response.status, 404, `${prefix}${suffix}`);
        assert.match(response.headers['content-type'], /^application\/json/);
      }
    }
  });

  test('rejects traversal, ambiguous separators, NUL and malformed encodings', async () => {
    // node:http preserves the request target; fetch would normalize dot segments
    // before the server sees them, accidentally hiding traversal regressions.
    const invalidPaths = [
      '/../root.png', '/./root.png', '/%2e%2e/root.png', '/%2E/root.png',
      '/%2e%2e%2froot.png', '/%2Froot.png', '/%5croot.png', '/folder%2Froot.png',
      '/folder%5croot.png', '/%00root.png', '//root.png', '/folder/../root.png',
      '/root.png/', '/%ZZ', '/%E0%A4%A'
    ];
    for (const prefix of ['/media', '/preview']) {
      for (const suffix of invalidPaths) {
        const response = await authorizedRequest(`${prefix}${suffix}`);
        assert.equal(response.status, 400, `${prefix}${suffix}`);
        assert.match(response.headers['content-type'], /^application\/json/);
      }
    }
    assert.equal((await request('/spa/%ZZ')).status, 400);
    assert.equal((await authorizedRequest('/media/root.png')).status, 200);
  });

  test('blocks symlinks to sibling files and directories outside MEDIA_ROOT', async () => {
    for (const prefix of ['/media', '/preview']) {
      for (const suffix of ['/escape.png', '/escape-dir/secret.png']) {
        const response = await authorizedRequest(`${prefix}${suffix}`);
        assert.equal(response.status, 403, `${prefix}${suffix}`);
        assert.match(response.headers['content-type'], /^application\/json/);
      }
    }
  });

  test('uses API-generated media URLs and simple query parameters correctly', async () => {
    const response = await authorizedRequest(`/api/media?path=${encodeURIComponent(path.posix.dirname(imagePath))}`);
    assert.equal(response.status, 200);
    const { items } = JSON.parse(response.body);
    assert.equal(items.length, 1);
    assert.equal(items[0].url, `/media${encodedImagePath}`);
    assert.equal(items[0].previewUrl, `/preview${encodedImagePath}`);
    assert.deepEqual((await authorizedRequest(items[0].url)).body, originalImage);
    assert.equal((await authorizedRequest(`${items[0].previewUrl}?size=240`)).status, 200);
  });

  test('handles undefined request bodies and JSON parser errors', async () => {
    const headers = { 'X-CSRF-Token': csrfToken };
    const login = await authorizedRequest('/api/login', { method: 'POST', headers });
    assert.equal(login.status, 401);
    const upload = await authorizedRequest('/api/upload', { method: 'POST', headers });
    assert.equal(upload.status, 200);
    assert.deepEqual(JSON.parse(upload.body), { saved: [], skipped: [] });
    const malformed = await authorizedRequest('/api/login', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{'
    });
    assert.equal(malformed.status, 400);
  });

  test('retains multipart uploads with CSRF protection', async () => {
    const form = new FormData();
    form.append('files', new Blob([originalImage], { type: 'image/png' }), 'uploaded.png');
    form.append('paths', JSON.stringify(['uploaded.png']));
    const response = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken }, body: form
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.saved[0].path, '/uploaded.png');
    assert.deepEqual((await authorizedRequest('/media/uploaded.png')).body, originalImage);
  });

  test('runs the existing authentication, tree and CSRF smoke suite', async () => {
    const { stdout } = await execFileAsync(process.execPath, [path.join(projectDir, 'scripts/smoke-test.mjs')], {
      cwd: runtimeDir, env: { ...environment, SMOKE_BASE_URL: baseUrl, SMOKE_PIN_CODE: '1234' }, timeout: 15_000
    });
    assert.match(stdout, /Smoke test passed/);
  });

  test('fails startup on an occupied port without announcing success', async (t) => {
    const second = spawnServer({ PORT: new URL(baseUrl).port });
    t.after(() => stopServer(second));
    let stderr = '';
    let stdout = '';
    second.stderr.on('data', (chunk) => { stderr += chunk; });
    second.stdout.on('data', (chunk) => { stdout += chunk; });
    const [code] = await once(second, 'exit');
    assert.notEqual(code, 0);
    assert.match(stderr, /EADDRINUSE/);
    assert.doesNotMatch(stdout, /Local Media Viewer:/);
  });

  test('rate limits content before authorization and shares the budget with SPA requests', async (t) => {
    const limited = spawnServer({ CONTENT_RATE_LIMIT_MAX_REQUESTS: '2' });
    t.after(() => stopServer(limited));
    const base = await waitForStartup(limited);
    assert.equal((await request('/media/root.png', { base })).status, 401);
    assert.equal((await request('/preview/root.png', { base })).status, 401);
    const rejected = await request('/album/nested', { base });
    assert.equal(rejected.status, 429);
    assert.ok(rejected.headers['retry-after']);
    assert.match(rejected.headers['content-type'], /^application\/json/);
    // Content traffic must not consume the API's independent rate-limit budget.
    assert.equal((await request('/api/csrf-token', { base })).status, 200);
  });
});

function spawnServer(overrides = {}) {
  return spawn(process.execPath, ['server/index.js'], {
    cwd: runtimeDir, env: { ...environment, ...overrides }, stdio: ['ignore', 'pipe', 'pipe']
  });
}

function waitForStartup(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => finish(new Error(`Server startup timed out: ${errors}`)), 10_000);
    function finish(error, url) {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      child.stdout.off('data', onData);
      if (error) reject(error);
      else resolve(url);
    }
    function onError(error) { finish(error); }
    function onExit(code) { finish(new Error(`Server exited (${code}): ${errors}`)); }
    function onData(chunk) {
      output += chunk;
      const match = output.match(/Local Media Viewer: http:\/\/localhost:(\d+)/);
      if (match) finish(null, `http://127.0.0.1:${match[1]}`);
    }
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', onError);
    child.on('exit', onExit);
    child.stdout.on('data', onData);
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3_000);
  try { await exited; } finally { clearTimeout(timer); }
}

function authorizedRequest(url, options = {}) {
  return request(url, { ...options, headers: { Cookie: cookie, ...options.headers } });
}

function request(url, { base = baseUrl, method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...headers };
    if (body !== undefined) requestHeaders['Content-Length'] = Buffer.byteLength(body);
    const req = http.request(base, { path: url, method, headers: requestHeaders }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error(`Request timed out: ${url}`)));
    req.end(body);
  });
}
