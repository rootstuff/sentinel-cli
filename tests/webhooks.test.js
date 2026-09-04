const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

const endpoint = {
  id: 4,
  name: 'PagerDuty bridge',
  url_host: 'hooks.example.com',
  auth_type: 'bearer',
  auth_header_name: null,
  severities: ['critical', 'warning'],
  is_active: true,
  last_delivered_at: null,
  created_at: '2026-01-01T00:00:00+00:00'
};

test('webhooks list', async () => {
  stub.setRoutes({ 'GET /api/v1/webhook-endpoints': { body: { total: 1, data: [endpoint] } } });

  const result = await runCli(['webhooks', 'list'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/webhook-endpoints');
  assert.match(result.stdout, /Webhook Endpoints \(1 total\)/);
  assert.match(result.stdout, /hooks\.example\.com/);
});

test('webhooks get --format json', async () => {
  stub.setRoutes({ 'GET /api/v1/webhook-endpoints/4': { body: endpoint } });

  const result = await runCli(['webhooks', 'get', '4', '--format', 'json'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/webhook-endpoints/4');
  assert.equal(JSON.parse(result.stdout).name, 'PagerDuty bridge');
});

test('webhooks create posts the full payload', async () => {
  stub.setRoutes({ 'POST /api/v1/webhook-endpoints': { status: 201, body: endpoint } });

  const result = await runCli([
    'webhooks', 'create',
    '--name', 'PagerDuty bridge',
    '--url', 'https://hooks.example.com/in',
    '--auth-type', 'bearer',
    '--auth-token', 'secret-token',
    '--signing-secret', 'sixteen-char-secret!',
    '--severities', 'critical,warning',
    '--active'
  ], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'POST', '/api/v1/webhook-endpoints');
  assert.deepEqual(request.body, {
    name: 'PagerDuty bridge',
    url: 'https://hooks.example.com/in',
    auth_type: 'bearer',
    auth_token: 'secret-token',
    signing_secret: 'sixteen-char-secret!',
    severities: ['critical', 'warning'],
    is_active: true
  });
  assert.match(result.stdout, /Webhook endpoint created successfully/);
});

test('webhooks create defaults auth_type to none', async () => {
  stub.setRoutes({ 'POST /api/v1/webhook-endpoints': { status: 201, body: endpoint } });

  const result = await runCli(['webhooks', 'create', '--name', 'Plain', '--url', 'https://hooks.example.com/in'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(stub.lastRequest().body, { name: 'Plain', url: 'https://hooks.example.com/in', auth_type: 'none' });
});

test('webhooks update fills required name/auth_type from the stored endpoint', async () => {
  stub.setRoutes({
    'GET /api/v1/webhook-endpoints/4': { body: endpoint },
    'PUT /api/v1/webhook-endpoints/4': { body: { ...endpoint, is_active: false } }
  });

  const result = await runCli(['webhooks', 'update', '4', '--no-active', '--severities', 'critical'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.requests[1], 'PUT', '/api/v1/webhook-endpoints/4');
  assert.deepEqual(stub.requests[1].body, {
    severities: ['critical'],
    is_active: false,
    name: 'PagerDuty bridge',
    auth_type: 'bearer'
  });
});

test('webhooks update carries the header name for header auth', async () => {
  stub.setRoutes({
    'GET /api/v1/webhook-endpoints/4': { body: { ...endpoint, auth_type: 'header', auth_header_name: 'X-Api-Key' } },
    'PUT /api/v1/webhook-endpoints/4': { body: endpoint }
  });

  const result = await runCli(['webhooks', 'update', '4', '--auth-token', 'rotated'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(stub.requests[1].body, {
    auth_token: 'rotated',
    name: 'PagerDuty bridge',
    auth_type: 'header',
    auth_header_name: 'X-Api-Key'
  });
});

test('webhooks delete --yes and test', async () => {
  stub.setRoutes({
    'DELETE /api/v1/webhook-endpoints/4': { status: 204 },
    'POST /api/v1/webhook-endpoints/4/test': { status: 202, body: { message: 'Test payload sent to PagerDuty bridge.' } }
  });

  let result = await runCli(['webhooks', 'test', '4'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'POST', '/api/v1/webhook-endpoints/4/test');
  assert.match(result.stdout, /Test payload sent to PagerDuty bridge/);

  result = await runCli(['webhooks', 'delete', '4', '--yes'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'DELETE', '/api/v1/webhook-endpoints/4');
  assert.match(result.stdout, /Webhook endpoint 4 deleted/);
});
