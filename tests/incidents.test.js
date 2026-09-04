const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, paginated, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

const incident = {
  id: 9,
  monitor: { id: 42, url: 'https://example.com' },
  status: 'open',
  started_at: '2026-09-01T10:00:00Z',
  ended_at: null,
  duration: null,
  root_cause: null,
  is_regional: false,
  activities: [{ created_at: '2026-09-01T10:05:00Z', description: 'Incident acknowledged by Ada' }]
};

test('incidents list sends filters', async () => {
  stub.setRoutes({ 'GET /api/v1/incidents': { body: paginated([incident]) } });

  const result = await runCli(['incidents', 'list', '--status', 'open', '--monitor-id', '42', '--start-date', '2026-09-01'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'GET', '/api/v1/incidents');
  assert.deepEqual(request.query, {
    monitor_id: '42', status: 'open', start_date: '2026-09-01', sort: 'started_at', direction: 'desc', per_page: '20'
  });
  assert.match(result.stdout, /Incidents \(1 total/);
  assert.match(result.stdout, /Ongoing/);
});

test('incidents list --format json', async () => {
  stub.setRoutes({ 'GET /api/v1/incidents': { body: paginated([incident]) } });

  const result = await runCli(['incidents', 'list', '--format', 'json'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data[0].id, 9);
});

test('incidents get prints details and activities', async () => {
  stub.setRoutes({ 'GET /api/v1/incidents/9': { body: incident } });

  const result = await runCli(['incidents', 'get', '9'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/incidents/9');
  assert.match(result.stdout, /Incident Details/);
  assert.match(result.stdout, /Incident acknowledged by Ada/);
});

test('incidents resolve, acknowledge and delete hit the right endpoints', async () => {
  stub.setRoutes({
    'POST /api/v1/incidents/9/resolve': { body: { ...incident, status: 'resolved', ended_at: '2026-09-01T11:00:00Z', duration: 60 } },
    'POST /api/v1/incidents/9/acknowledge': { body: { success: true, message: 'Incident acknowledged', incident } },
    'DELETE /api/v1/incidents/9': { status: 204 }
  });

  let result = await runCli(['incidents', 'resolve', '9'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'POST', '/api/v1/incidents/9/resolve');
  assert.match(result.stdout, /Incident resolved successfully/);
  assert.match(result.stdout, /60 minutes/);

  result = await runCli(['incidents', 'ack', '9'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'POST', '/api/v1/incidents/9/acknowledge');
  assert.match(result.stdout, /Incident acknowledged successfully/);

  result = await runCli(['incidents', 'delete', '9', '--yes'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'DELETE', '/api/v1/incidents/9');
  assert.match(result.stdout, /Incident 9 deleted/);
});
