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
  stub.setRoutes({ 'GET /api/v1/admin/freshness': { body: { generated_at: 'x', regions: { ash: { monitors: 70, stale: 1, oldest_lag_seconds: 199275, stale_monitors: [{ monitor_id: 42, url: 'https://forgotten.example', check_interval_seconds: 60, last_checked_at: '2026-09-03T20:00:00+00:00', lag_seconds: 199275 }] } }, queue_wait_seconds: { 'monitor-ash': 1 } } } });

  const result = await runCli(['admin', 'freshness'], { stub, env: { SENTINEL_ADMIN_TOKEN: 'operator-token' } });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(stub.lastRequest().headers.authorization, 'Bearer operator-token');
  assert.match(result.stdout, /Region freshness/);
  assert.match(result.stdout, /monitor-ash/);
  assert.match(result.stdout, /forgotten\.example/);
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

test('admin monitors passes filters and renders the table', async () => {
  stub.setRoutes({ 'GET /api/v1/admin/monitors': { body: { total: 1, offset: 0, limit: 50, monitors: [{ monitor_id: 201, url: 'https://www.shipon007.com/', friendly_name: null, type: 'http', check_interval_seconds: 300, status: 'offline', is_paused: false, team_id: 58, team_name: 'Shipon', owner_email: 'owner@shipon.example', monitored_regions: null, last_checked_at: 'x', safe_browsing_threat: null }] } } });

  const result = await runCli(['admin', 'monitors', '--host', 'shipon007', '--status', 'offline', '--flagged'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'GET', '/api/v1/admin/monitors');
  assert.deepEqual(request.query, { host: 'shipon007', status: 'offline', flagged: '1' });
  assert.match(result.stdout, /Monitors \(1 of 1\)/);
  assert.match(result.stdout, /shipon007/);
  assert.match(result.stdout, /owner@shipon\.example/);
});

test('admin monitor renders config, regions, and incidents', async () => {
  stub.setRoutes({ 'GET /api/v1/admin/monitors/163': { body: {
    monitor_id: 163, url: 'https://sentinel.rootstuff.io/', friendly_name: 'Homepage', type: 'http', check_interval_seconds: 30, status: 'online', is_paused: false, team_id: 1, team_name: 'Adam Balee', owner_email: 'me@adambalee.com', safe_browsing_threat: null,
    config: { method: 'GET', request_timeout_seconds: 30, follow_redirects: true, accepted_status_codes: ['2xx'], check_types: ['ssl', 'keyword'], monitored_regions: null, auth_type: null, has_request_headers: false, error_text_detection: true },
    regions: { ash: { last_checked_at: '2026-09-06T01:41:19+00:00', lag_seconds: 12, latest_check: { response_time_ms: 136, status_code: 200, status: 'online', error: null, checked_at: 'x' } } },
    recent_incidents: [{ id: 9157, type: 'uptime', root_cause: 'HTTP 500', is_regional: false, region: null, started_at: '2026-09-04T16:49:09+00:00', ended_at: '2026-09-04T16:50:06+00:00' }],
    created_at: 'x'
  } } });

  const result = await runCli(['admin', 'monitor', '163'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/admin/monitors/163');
  assert.match(result.stdout, /Monitor 163/);
  assert.match(result.stdout, /136ms/);
  assert.match(result.stdout, /HTTP 500/);
  assert.match(result.stdout, /ssl, keyword/);
});

test('admin account requires a selector and renders the account', async () => {
  let result = await runCli(['admin', 'account'], { stub });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--email, --user-id, or --team-id/);

  stub.setRoutes({ 'GET /api/v1/admin/account': { body: {
    user: { id: 7, name: 'Gabriel', email: 'gabriel@vbotickets.com', email_verified: true, two_factor: true, is_super_admin: false, suspended_at: null, suspended_reason: null, signed_up_at: '2026-08-09T00:00:00+00:00', last_login_at: '2026-09-05T00:00:00+00:00', timezone: 'America/New_York' },
    plan: { type: 'business_beta', plan_owner_id: 7, plan_owner_email: 'gabriel@vbotickets.com', subscription: { type: 'business_beta', status: 'active', comped: true, trial_ends_at: null, ends_at: null } },
    teams: [{ team_id: 4, name: 'VBO', role: 'owner', monitors: 22, members: 2 }],
    tokens: [{ id: 3, name: 'Terraform', abilities: ['read', 'create', 'update', 'delete'], last_used_at: '2026-09-05T00:00:00+00:00', created_at: 'x' }],
    signup: { outcome: 'created', utm_source: null, landing_path: '/contact', country: 'US', form_ms: 8000, at: 'x' },
    team: { team_id: 4, name: 'VBO', owner_email: 'gabriel@vbotickets.com', monitors: 22, members: [{ id: 7, email: 'gabriel@vbotickets.com', role: 'owner', two_factor: true }, { id: 8, email: 'samuel@vbotickets.com', role: 'admin', two_factor: false }] }
  } } });

  result = await runCli(['admin', 'account', '--team-id', '4'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'GET', '/api/v1/admin/account');
  assert.deepEqual(request.query, { team_id: '4' });
  assert.match(result.stdout, /gabriel@vbotickets\.com/);
  assert.match(result.stdout, /business_beta/);
  assert.match(result.stdout, /comped/);
  assert.match(result.stdout, /Terraform/);
  assert.match(result.stdout, /samuel@vbotickets\.com/);
});

test('admin queues and signups render', async () => {
  stub.setRoutes({
    'GET /api/v1/admin/queues': { body: { generated_at: 'x', queues: { 'monitor-nbg': { pending: 475, delayed: 19, reserved: 7, oldest_pending_age_seconds: 180, workers: { 'nbg-worker': 8 }, worker_total: 8 } } } },
    'GET /api/v1/admin/signups': { body: { window_hours: 24, since: 'x', signups: [{ user_id: 99, email: 'new@example.com', name: 'New', signed_up_at: 'x', email_verified: false, suspended: false, monitors: 1, plan: 'free', signup: { outcome: 'created', utm_source: 'github', country: 'DE' } }], blocked_attempts: [{ at: 'x', email: 'bot@example.com', outcome: 'blocked_honeypot', country: null, form_ms: 300 }] } }
  });

  let result = await runCli(['admin', 'queues'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/admin/queues');
  assert.match(result.stdout, /monitor-nbg/);
  assert.match(result.stdout, /nbg-worker:8/);

  result = await runCli(['admin', 'signups', '--hours', '24'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/admin/signups');
  assert.match(result.stdout, /new@example\.com/);
  assert.match(result.stdout, /blocked_honeypot/);
});
