const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const BIN = path.join(__dirname, '..', 'bin', 'sentinel.js');

/**
 * A recording HTTP stub. Each test registers the routes it expects
 * ("GET /api/v1/monitors" -> { status, body }); anything else answers 404 so
 * a wrong path shows up as an assertion failure rather than a silent pass.
 */
async function startStub() {
  const requests = [];
  let routes = {};

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const record = {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        rawQuery: url.search,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null
      };
      requests.push(record);

      const route = routes[`${req.method} ${url.pathname}`];
      const status = route ? (route.status ?? 200) : 404;
      const body = route?.body ?? { message: `No stub for ${req.method} ${url.pathname}` };
      const payload = route?.raw !== undefined ? route.raw : JSON.stringify(body);

      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(status === 204 ? '' : payload);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    setRoutes(map) {
      routes = map;
      requests.length = 0;
    },
    lastRequest() {
      return requests[requests.length - 1];
    },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

/**
 * Run the real CLI binary against the stub, with config isolated to a temp dir.
 */
function runCli(args, { stub, env = {}, token = 'test-token' } = {}) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-test-'));

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        SENTINEL_CONFIG_DIR: configDir,
        SENTINEL_API_URL: stub.url,
        ...(token ? { SENTINEL_TOKEN: token } : {}),
        ...env
      }
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      fs.rmSync(configDir, { recursive: true, force: true });
      resolve({ code, stdout, stderr, configDir });
    });
  });
}

function paginated(data, extra = {}) {
  return {
    current_page: 1,
    last_page: 1,
    from: 1,
    to: data.length,
    total: data.length,
    per_page: 20,
    data,
    ...extra
  };
}

function assertRequest(request, method, pathname) {
  assert.ok(request, `expected a ${method} ${pathname} request`);
  assert.equal(request.method, method);
  assert.equal(request.path, pathname);
  assert.equal(request.headers.authorization, 'Bearer test-token');
  assert.equal(request.headers.accept, 'application/json');
}

module.exports = { startStub, runCli, paginated, assertRequest };
