const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, paginated, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

const monitor = {
  id: 42,
  url: 'https://example.com',
  friendly_name: 'Example',
  monitor_type: 'http',
  status: 'online',
  check_interval: 0.5,
  check_types: ['ssl'],
  monitored_regions: ['ash', 'pdx', 'nbg', 'sin'],
  is_paused: false,
  last_checked_at: '2026-09-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z'
};

test('monitors list sends filters and renders a table', async () => {
  stub.setRoutes({ 'GET /api/v1/monitors': { body: paginated([monitor]) } });

  const result = await runCli(
    ['monitors', 'list', '--status', 'online', '--type', 'http', '--search', 'example', '--per-page', '5', '--page', '2'],
    { stub }
  );

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'GET', '/api/v1/monitors');
  assert.deepEqual(request.query, {
    status: 'online', type: 'http', search: 'example', sort: 'url', direction: 'asc', page: '2', per_page: '5'
  });
  assert.match(result.stdout, /Monitors \(1 total/);
  assert.match(result.stdout, /https:\/\/example\.com/);
  assert.match(result.stdout, /30s/);
});

test('monitors list --format json prints raw JSON', async () => {
  stub.setRoutes({ 'GET /api/v1/monitors': { body: paginated([monitor]) } });

  const result = await runCli(['monitors', 'list', '--format', 'json'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.data[0].id, 42);
});

test('monitors list with no results says so', async () => {
  stub.setRoutes({ 'GET /api/v1/monitors': { body: paginated([]) } });

  const result = await runCli(['monitors', 'list'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /No monitors found/);
});

test('monitors get shows details and per-region response times', async () => {
  stub.setRoutes({
    'GET /api/v1/monitors/42': {
      body: { ...monitor, response_times: [{ region: 'ash', response_time: 120, status_code: 200, checked_at: '2026-09-01T00:00:00Z' }] }
    }
  });

  const result = await runCli(['monitors', 'get', '42'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/monitors/42');
  assert.match(result.stdout, /Monitor Details/);
  assert.match(result.stdout, /ash\s+120ms\s+HTTP 200/);
  assert.match(result.stdout, /ash, pdx, nbg, sin/);
});

test('monitors create maps every flag onto the API payload', async () => {
  stub.setRoutes({ 'POST /api/v1/monitors': { status: 201, body: monitor } });

  const result = await runCli([
    'monitors', 'create',
    '--url', 'https://example.com',
    '--name', 'Example',
    '--interval', '0.5',
    '--check-types', 'ssl,dns,payment',
    '--regions', 'ash,nbg',
    '--group-id', '9',
    '--method', 'post',
    '--accepted-status-codes', '200,3xx',
    '--no-follow-redirects',
    '--timeout', '20',
    '--headers', '{"X-Test":"1"}',
    '--body', '{"ping":true}',
    '--ssl-threshold', '14',
    '--domain-threshold', '30',
    '--slow-response-threshold', '2500',
    '--payment-settings', '{"expected":{"amount":"0.02","pay_to":"0xabc","network":"eip155:8453"}}'
  ], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'POST', '/api/v1/monitors');
  assert.deepEqual(request.body, {
    monitor_type: 'http',
    url: 'https://example.com',
    friendly_name: 'Example',
    check_interval: 0.5,
    check_types: ['ssl', 'dns', 'payment'],
    monitored_regions: ['ash', 'nbg'],
    group_id: 9,
    http_method: 'POST',
    accepted_status_codes: ['200', '3xx'],
    follow_redirects: false,
    request_timeout: 20,
    request_headers: { 'X-Test': '1' },
    request_body: '{"ping":true}',
    ssl_expiry_threshold: 14,
    domain_expiry_threshold: 30,
    slow_response_threshold: 2500,
    payment_settings: { expected: { amount: '0.02', pay_to: '0xabc', network: 'eip155:8453' } }
  });
  assert.match(result.stdout, /Monitor created successfully/);
});

test('monitors create sends keyword and JSON assertion settings', async () => {
  stub.setRoutes({ 'POST /api/v1/monitors': { status: 201, body: monitor } });

  const result = await runCli([
    'monitors', 'create', '--url', 'https://example.com',
    '--keyword-settings', '{"keywords":[{"phrase":"OK","mode":"must_contain"}]}',
    '--json-assertion-settings', '{"assertions":[{"path":"status","operator":"equals","value":"ok"}]}',
    '--lighthouse-settings', '{"strategies":["mobile"]}'
  ], { stub });

  assert.equal(result.code, 0, result.stderr);
  const body = stub.lastRequest().body;
  assert.deepEqual(body.keyword_settings, { keywords: [{ phrase: 'OK', mode: 'must_contain' }] });
  assert.deepEqual(body.json_assertion_settings, { assertions: [{ path: 'status', operator: 'equals', value: 'ok' }] });
  assert.deepEqual(body.lighthouse_settings, { strategies: ['mobile'] });
});

test('monitors create builds heartbeat and port monitors', async () => {
  stub.setRoutes({ 'POST /api/v1/monitors': { status: 201, body: { ...monitor, monitor_type: 'heartbeat' } } });

  let result = await runCli([
    'monitors', 'create', '--type', 'heartbeat', '--name', 'Nightly backup',
    '--heartbeat-interval', '3600', '--heartbeat-grace', '300', '--heartbeat-timezone', 'UTC'
  ], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(stub.lastRequest().body, {
    monitor_type: 'heartbeat',
    friendly_name: 'Nightly backup',
    heartbeat_interval: 3600,
    heartbeat_grace: 300,
    heartbeat_timezone: 'UTC'
  });

  result = await runCli(['monitors', 'create', '--type', 'cron', '--name', 'Report', '--cron-expression', '0 6 * * *'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(stub.lastRequest().body.heartbeat_cron_expression, '0 6 * * *');

  result = await runCli(['monitors', 'create', '--type', 'port', '--url', 'db.example.com', '--port', '5432'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(stub.lastRequest().body, { monitor_type: 'port', url: 'db.example.com', port: 5432 });
});

test('monitors create rejects malformed JSON flags before calling the API', async () => {
  stub.setRoutes({});

  const result = await runCli(['monitors', 'create', '--url', 'https://example.com', '--payment-settings', '{oops'], { stub });

  assert.equal(result.code, 1);
  assert.equal(stub.requests.length, 0);
  assert.match(result.stderr, /--payment-settings must be valid JSON/);
});

test('monitors update fetches the monitor and merges the change', async () => {
  stub.setRoutes({
    'GET /api/v1/monitors/42': { body: monitor },
    'PUT /api/v1/monitors/42': { body: { ...monitor, check_interval: 5 } }
  });

  const result = await runCli(['monitors', 'update', '42', '--interval', '5'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.requests[0], 'GET', '/api/v1/monitors/42');
  assertRequest(stub.requests[1], 'PUT', '/api/v1/monitors/42');
  assert.deepEqual(stub.requests[1].body, {
    url: 'https://example.com',
    check_interval: 5,
    check_types: ['ssl']
  });
  assert.match(result.stdout, /Monitor updated successfully/);
});

test('monitors update --check-types payment --payment-settings sends the settings object', async () => {
  stub.setRoutes({
    'GET /api/v1/monitors/42': { body: monitor },
    'PUT /api/v1/monitors/42': { body: { ...monitor, check_types: ['payment'] } }
  });

  const result = await runCli([
    'monitors', 'update', '42', '--check-types', 'payment',
    '--payment-settings', '{"expected":{"amount":"0.02","pay_to":"0xabc","network":"eip155:8453"}}'
  ], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(stub.requests[1].body, {
    url: 'https://example.com',
    check_types: ['payment'],
    payment_settings: { expected: { amount: '0.02', pay_to: '0xabc', network: 'eip155:8453' } }
  });
});

test('monitors update keeps stored sub-check settings when only unrelated fields change', async () => {
  stub.setRoutes({
    'GET /api/v1/monitors/42': {
      body: { ...monitor, check_types: ['keyword'], keyword_settings: { keywords: [{ phrase: 'OK', mode: 'must_contain' }] } }
    },
    'PUT /api/v1/monitors/42': { body: monitor }
  });

  const result = await runCli(['monitors', 'update', '42', '--group-id', 'none', '--follow-redirects'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(stub.requests[1].body, {
    url: 'https://example.com',
    group_id: null,
    follow_redirects: true,
    check_types: ['keyword'],
    keyword_settings: { keywords: [{ phrase: 'OK', mode: 'must_contain' }] }
  });
});

test('monitors update on a push monitor sends the schedule, never the url', async () => {
  stub.setRoutes({
    'GET /api/v1/monitors/7': {
      body: { ...monitor, id: 7, monitor_type: 'heartbeat', friendly_name: 'Backup', heartbeat_interval: 3600, check_types: [] }
    },
    'PUT /api/v1/monitors/7': { body: monitor }
  });

  const result = await runCli(['monitors', 'update', '7', '--heartbeat-grace', '120', '--url', 'https://ignored.example'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(stub.requests[1].body, {
    heartbeat_grace: 120,
    friendly_name: 'Backup',
    heartbeat_interval: 3600,
    check_types: []
  });
});

test('monitors update with no flags exits 1 without a request', async () => {
  stub.setRoutes({});

  const result = await runCli(['monitors', 'update', '42'], { stub });

  assert.equal(result.code, 1);
  assert.equal(stub.requests.length, 0);
  assert.match(result.stderr, /At least one field/);
});

test('monitors delete --yes issues DELETE', async () => {
  stub.setRoutes({ 'DELETE /api/v1/monitors/42': { status: 204 } });

  const result = await runCli(['monitors', 'delete', '42', '--yes'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'DELETE', '/api/v1/monitors/42');
  assert.match(result.stdout, /Monitor 42 deleted/);
});

test('monitors check, pause and unpause POST to the action endpoints', async () => {
  stub.setRoutes({
    'POST /api/v1/monitors/42/check': { body: { uptime: { status: 'online', response_time: 88, status_code: 200 }, ssl: null } },
    'POST /api/v1/monitors/42/pause': { body: { success: true, message: 'Monitor paused', monitor: { id: 42, url: 'https://example.com', is_paused: true } } },
    'POST /api/v1/monitors/42/unpause': { body: { success: true, message: 'Monitor resumed', monitor: { id: 42, url: 'https://example.com', is_paused: false } } }
  });

  let result = await runCli(['monitors', 'check', '42'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'POST', '/api/v1/monitors/42/check');
  assert.match(result.stdout, /88ms/);

  result = await runCli(['monitors', 'pause', '42'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'POST', '/api/v1/monitors/42/pause');
  assert.match(result.stdout, /Monitor paused/);

  result = await runCli(['monitors', 'resume', '42'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'POST', '/api/v1/monitors/42/unpause');
  assert.match(result.stdout, /Monitor resumed/);
});

test('a 403 plan limit on create is surfaced with the API message', async () => {
  stub.setRoutes({
    'POST /api/v1/monitors': { status: 403, body: { message: 'This team has reached the monitor limit of 5 for its current plan.' } }
  });

  const result = await runCli(['monitors', 'create', '--url', 'https://example.com'], { stub });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /API Error \(403\): This team has reached the monitor limit/);
});
