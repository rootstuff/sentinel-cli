const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

function region(code, name, status, extra = {}) {
  return {
    region: code,
    name,
    status,
    status_code: status === 'online' ? 200 : null,
    response_time_ms: status === 'online' ? 140 : null,
    dns_ms: 5,
    tcp_ms: 20,
    tls_ms: 40,
    ttfb_ms: 130,
    error: null,
    ...extra
  };
}

function checkResult(verdict, results) {
  const reachable = results.filter((r) => r.status === 'online').length;
  return {
    url: 'https://example.com',
    checked_at: '2026-09-02T12:00:00+00:00',
    verdict,
    reachable_regions: reachable,
    total_regions: results.length,
    results
  };
}

test('check sends url, regions and timeout and exits 0 when every region is up', async () => {
  stub.setRoutes({
    'GET /api/v1/check-url': {
      body: checkResult('up', [
        region('ash', 'Ashburn', 'online'),
        region('pdx', 'Portland', 'online'),
        region('nbg', 'Nuremberg', 'online'),
        region('sin', 'Singapore', 'online')
      ])
    }
  });

  const result = await runCli(['check', 'https://example.com', '--regions', 'ash,sin', '--timeout', '10'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'GET', '/api/v1/check-url');
  assert.equal(request.query.url, 'https://example.com');
  assert.equal(request.query.timeout_seconds, '10');
  assert.match(request.rawQuery, /regions%5B%5D=ash/);
  assert.match(request.rawQuery, /regions%5B%5D=sin/);
  assert.match(result.stdout, /Ashburn/);
  assert.match(result.stdout, /Verdict: UP/);
  assert.match(result.stdout, /4 of 4 regions reached/);
});

test('check exits 1 on a partial verdict unless --allow-partial', async () => {
  const body = checkResult('partial', [
    region('ash', 'Ashburn', 'online'),
    region('sin', 'Singapore', 'offline', { error: 'timeout' })
  ]);
  stub.setRoutes({ 'GET /api/v1/check-url': { body } });

  let result = await runCli(['check', 'https://example.com'], { stub });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Verdict: PARTIAL/);
  assert.match(result.stdout, /timeout/);

  result = await runCli(['check', 'https://example.com', '--allow-partial'], { stub });
  assert.equal(result.code, 0, result.stderr);
});

test('check exits 1 on down and unknown verdicts', async () => {
  stub.setRoutes({ 'GET /api/v1/check-url': { body: checkResult('down', [region('ash', 'Ashburn', 'offline')]) } });
  let result = await runCli(['check', 'https://example.com'], { stub });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Verdict: DOWN/);

  stub.setRoutes({ 'GET /api/v1/check-url': { body: checkResult('unknown', [region('ash', 'Ashburn', 'error', { error: 'region_unreachable' })]) } });
  result = await runCli(['check', 'https://example.com', '--allow-partial'], { stub });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Verdict: UNKNOWN/);
});

test('check --format json prints the raw result and still sets the exit code', async () => {
  stub.setRoutes({ 'GET /api/v1/check-url': { body: checkResult('down', [region('ash', 'Ashburn', 'offline')]) } });

  const result = await runCli(['check', 'https://example.com', '--format', 'json'], { stub });

  assert.equal(result.code, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.verdict, 'down');
});

test('check explains the plan gate on 403', async () => {
  stub.setRoutes({
    'GET /api/v1/check-url': {
      status: 403,
      body: { error: 'On-demand global checks are not included in the free plan. Any paid plan includes them.' }
    }
  });

  const result = await runCli(['check', 'https://example.com'], { stub });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /not available on this plan/);
  assert.match(result.stderr, /not included in the free plan/);
  assert.match(result.stderr, /pricing/);
});

test('check reports rate limiting on 429', async () => {
  stub.setRoutes({
    'GET /api/v1/check-url': { status: 429, body: { error: 'Rate limit reached: too many checks this minute.' } }
  });

  const result = await runCli(['check', 'https://example.com'], { stub });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Rate limit reached/);
});
