const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, paginated, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

const page = {
  id: 2,
  name: 'Acme Status',
  slug: 'acme',
  description: 'Public status',
  logo_url: null,
  custom_domain: 'status.acme.test',
  domain_verified: false,
  settings: { show_uptime_percentage: true },
  services: [
    { monitor_id: 42, label: 'API', monitor_url: 'https://api.acme.test', monitor_status: 'online' },
    { monitor_id: 43, label: 'Website', monitor_url: 'https://acme.test', monitor_status: 'offline' }
  ],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
};

test('status-pages list', async () => {
  stub.setRoutes({ 'GET /api/v1/status-pages': { body: paginated([page]) } });

  const result = await runCli(['status-pages', 'list', '--search', 'acme'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'GET', '/api/v1/status-pages');
  assert.equal(request.query.search, 'acme');
  assert.equal(request.query.sort, 'title');
  assert.match(result.stdout, /Acme Status/);
  assert.match(result.stdout, /status\.acme\.test \(unverified\)/);
});

test('status-pages get lists services', async () => {
  stub.setRoutes({ 'GET /api/v1/status-pages/2': { body: page } });

  const result = await runCli(['status-pages', 'get', '2'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/status-pages/2');
  assert.match(result.stdout, /Services \(2\)/);
  assert.match(result.stdout, /Website/);
});

test('status-pages get --format json', async () => {
  stub.setRoutes({ 'GET /api/v1/status-pages/2': { body: page } });

  const result = await runCli(['status-pages', 'get', '2', '--format', 'json'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).services.length, 2);
});

test('status-pages create sends the monitors array with optional labels', async () => {
  stub.setRoutes({ 'POST /api/v1/status-pages': { status: 201, body: page } });

  const result = await runCli([
    'status-pages', 'create', '--name', 'Acme Status', '--slug', 'acme',
    '--monitors', '42:API,43', '--description', 'Public status', '--settings', '{"show_response_time":false}'
  ], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'POST', '/api/v1/status-pages');
  assert.deepEqual(request.body, {
    monitors: [{ id: 42, label: 'API' }, { id: 43 }],
    name: 'Acme Status',
    slug: 'acme',
    description: 'Public status',
    settings: { show_response_time: false }
  });
  assert.match(result.stdout, /Status page created successfully/);
});

test('status-pages create accepts the legacy --monitor-id shorthand', async () => {
  stub.setRoutes({ 'POST /api/v1/status-pages': { status: 201, body: page } });

  const result = await runCli(['status-pages', 'create', '--name', 'Acme Status', '--slug', 'acme', '--monitor-id', '42'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(stub.lastRequest().body.monitors, [{ id: 42 }]);
});

test('status-pages update and delete', async () => {
  stub.setRoutes({
    'PUT /api/v1/status-pages/2': { body: { ...page, name: 'New name' } },
    'DELETE /api/v1/status-pages/2': { status: 204 }
  });

  let result = await runCli(['status-pages', 'update', '2', '--name', 'New name', '--monitors', '43:Site'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'PUT', '/api/v1/status-pages/2');
  assert.deepEqual(stub.lastRequest().body, { name: 'New name', monitors: [{ id: 43, label: 'Site' }] });

  result = await runCli(['status-pages', 'delete', '2', '--yes'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'DELETE', '/api/v1/status-pages/2');
});
