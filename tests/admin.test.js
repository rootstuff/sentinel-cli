const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

const cadence = {
  window_minutes: 10,
  since: '2026-09-05T13:20:00+00:00',
  generated_at: '2026-09-05T13:30:00+00:00',
  monitors: [{
    monitor_id: 163,
    url: 'https://sentinel.rootstuff.io/',
    check_interval_seconds: 30,
    regions: {
      ash: { checks: 20, expected: 20, max_gap_seconds: 32, mean_gap_seconds: 30.0 },
      sin: { checks: 10, expected: 20, max_gap_seconds: 67, mean_gap_seconds: 60.0 }
    }
  }]
};

test('admin cadence renders per-region rows and passes the filters', async () => {
  stub.setRoutes({ 'GET /api/v1/admin/cadence': { body: cadence } });

  const result = await runCli(['admin', 'cadence', '--monitor-id', '163', '--minutes', '10'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'GET', '/api/v1/admin/cadence');
  assert.deepEqual(request.query, { monitor_id: '163', minutes: '10' });
  assert.match(result.stdout, /Cadence over the last 10 minutes/);
  assert.match(result.stdout, /sin/);
  assert.match(result.stdout, /67s/);
});

test('admin cadence --format json', async () => {
  stub.setRoutes({ 'GET /api/v1/admin/cadence': { body: cadence } });

  const result = await runCli(['admin', 'cadence', '--format', 'json'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).monitors[0].regions.sin.checks, 10);
});

test('admin prefers SENTINEL_ADMIN_TOKEN over the everyday token', async () => {
  stub.setRoutes({ 'GET /api/v1/admin/freshness': { body: { generated_at: 'x', regions: { ash: { monitors: 70, stale: 0, oldest_lag_seconds: 12 } }, queue_wait_seconds: { 'monitor-ash': 1 } } } });

  const result = await runCli(['admin', 'freshness'], { stub, env: { SENTINEL_ADMIN_TOKEN: 'operator-token' } });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(stub.lastRequest().headers.authorization, 'Bearer operator-token');
  assert.match(result.stdout, /Region freshness/);
  assert.match(result.stdout, /monitor-ash/);
});

test('--token still beats SENTINEL_ADMIN_TOKEN', async () => {
  stub.setRoutes({ 'GET /api/v1/admin/freshness': { body: { generated_at: 'x', regions: {}, queue_wait_seconds: {} } } });

  const result = await runCli(['admin', 'freshness', '--token', 'flag-token'], { stub, env: { SENTINEL_ADMIN_TOKEN: 'operator-token' } });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(stub.lastRequest().headers.authorization, 'Bearer flag-token');
});

test('admin incidents groups by root cause and lists the newest', async () => {
  stub.setRoutes({ 'GET /api/v1/admin/incidents': { body: {
    window_hours: 2, since: 'x', total_opened: 3,
    by_root_cause: [{ root_cause: 'Will not follow more than 3 redirects', opened: 2, still_open: 0, latest_at: '2026-09-05T13:00:00+00:00' }],
    latest: [{ id: 9155, monitor_id: 220, url: 'https://eventmanager.vbotickets.com/signin', team_id: 4, root_cause: 'Will not follow more than 3 redirects', is_regional: false, region: null, started_at: '2026-09-05T13:00:00+00:00', ended_at: null }]
  } } });

  const result = await runCli(['admin', 'incidents', '--hours', '2', '--contains', 'redirect'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'GET', '/api/v1/admin/incidents');
  assert.deepEqual(request.query, { hours: '2', contains: 'redirect' });
  assert.match(result.stdout, /3 incidents opened in the last 2 hours/);
  assert.match(result.stdout, /eventmanager\.vbotickets\.com/);
  assert.match(result.stdout, /open/);
});

test('admin api-errors, abuse, and failed-jobs hit their endpoints', async () => {
  stub.setRoutes({
    'GET /api/v1/admin/api-errors': { body: { window_hours: 24, since: 'x', total_requests: 100, error_requests: 5, error_rate_pct: 5, by_path: [{ method: 'POST', path: '/mcp/sentinel-oauth', status_code: 500, requests: 5, users: 1, latest_at: 'x' }] } },
    'GET /api/v1/admin/abuse': { body: { generated_at: 'x', flagged_monitors: [{ monitor_id: 1, url: 'https://kit.example', threat: 'SOCIAL_ENGINEERING', flagged_at: 'x', is_paused: false, owner: { id: 9, email: 'kit@example.com', signed_up_at: 'x' } }], unverified_users_with_monitors: [], hosts_monitored_by_multiple_teams: [{ host: 'shared.example.com', monitors: 4, teams: 2 }] } },
    'GET /api/v1/admin/failed-jobs': { body: { window_hours: 12, since: 'x', total_failures: 351, by_error: [{ queue: 'monitor-sin', error: 'Error: Typed property must not be accessed', failures: 351, latest_at: 'x' }] } }
  });

  let result = await runCli(['admin', 'api-errors', '--hours', '24'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/admin/api-errors');
  assert.match(result.stdout, /5 errors in 100 requests/);
  assert.match(result.stdout, /sentinel-oauth/);

  result = await runCli(['admin', 'abuse'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/admin/abuse');
  assert.match(result.stdout, /Flagged monitors \(1\)/);
  assert.match(result.stdout, /kit@example\.com/);
  assert.match(result.stdout, /shared\.example\.com/);

  result = await runCli(['admin', 'failed-jobs', '--hours', '12'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/admin/failed-jobs');
  assert.match(result.stdout, /351 failed jobs/);
  assert.match(result.stdout, /monitor-sin/);
});

test('admin surfaces the 403 the API sends to non-operators', async () => {
  stub.setRoutes({ 'GET /api/v1/admin/freshness': { status: 403, body: { message: 'This endpoint is for platform operators only.' } } });

  const result = await runCli(['admin', 'freshness'], { stub });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /platform operators only/);
});
