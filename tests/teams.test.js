const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

const teams = [
  { id: 1, name: 'Personal', slug: 'personal', personal_team: true, role: 'owner', is_current: false },
  { id: 2, name: 'Acme', slug: 'acme', personal_team: false, role: 'admin', is_current: true }
];

test('teams list', async () => {
  stub.setRoutes({ 'GET /api/v1/teams': { body: { data: teams } } });

  const result = await runCli(['teams', 'list'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/teams');
  assert.match(result.stdout, /Acme/);
  assert.match(result.stdout, /admin/);
});

test('teams list --format json', async () => {
  stub.setRoutes({ 'GET /api/v1/teams': { body: { data: teams } } });

  const result = await runCli(['teams', 'list', '--format', 'json'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.length, 2);
});

test('teams switch POSTs to the switch endpoint', async () => {
  stub.setRoutes({ 'POST /api/v1/teams/1/switch': { body: { id: 1, name: 'Personal', slug: 'personal', personal_team: true } } });

  const result = await runCli(['teams', 'switch', '1'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'POST', '/api/v1/teams/1/switch');
  assert.match(result.stdout, /Switched to team "Personal"/);
});

test('teams switch to a foreign team shows the 403', async () => {
  stub.setRoutes({ 'POST /api/v1/teams/99/switch': { status: 403, body: { message: 'You do not belong to this team.' } } });

  const result = await runCli(['teams', 'switch', '99'], { stub });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /You do not belong to this team/);
});
