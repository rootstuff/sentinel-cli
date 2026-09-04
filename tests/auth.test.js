const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

test('auth whoami reads the v1 root and prints user + team', async () => {
  stub.setRoutes({
    'GET /api/v1': {
      body: {
        api: { name: 'Sentinel API', version: '1.0' },
        user: { id: 7, name: 'Ada Lovelace', email: 'ada@example.com', timezone: 'UTC' },
        team: { id: 3, name: 'Analytical Engines', slug: 'analytical-engines', personal_team: false }
      }
    }
  });

  const result = await runCli(['auth', 'whoami'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1');
  assert.match(result.stdout, /Ada Lovelace/);
  assert.match(result.stdout, /Analytical Engines/);
  assert.match(result.stdout, /Token Source.*environment/);
});

test('auth whoami without a token exits 0 with guidance and no request', async () => {
  stub.setRoutes({});

  const result = await runCli(['auth', 'whoami'], { stub, token: null });

  assert.equal(result.code, 0);
  assert.equal(stub.requests.length, 0);
  assert.match(result.stdout, /Not authenticated/);
});

test('auth login verifies the token against /test and persists it', async () => {
  stub.setRoutes({
    'GET /api/v1/test': {
      body: { message: 'ok', user: { id: 7, name: 'Ada Lovelace', email: 'ada@example.com' } }
    }
  });

  const result = await runCli(['auth', 'login', '--token', 'test-token'], { stub, token: null });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/test');
  assert.match(result.stdout, /Successfully authenticated/);
});

test('auth login with a rejected token exits 1', async () => {
  stub.setRoutes({
    'GET /api/v1/test': { status: 401, body: { message: 'Unauthenticated.' } }
  });

  const result = await runCli(['auth', 'login', '--token', 'test-token'], { stub, token: null });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /API Error \(401\): Unauthenticated/);
});

test('auth status makes no network call', async () => {
  stub.setRoutes({});

  const result = await runCli(['auth', 'status'], { stub });

  assert.equal(result.code, 0);
  assert.equal(stub.requests.length, 0);
  assert.match(result.stdout, /API URL/);
  assert.match(result.stdout, /test-tok\.\.\./);
});

test('a missing token fails fast with instructions', async () => {
  stub.setRoutes({});

  const result = await runCli(['monitors', 'list'], { stub, token: null });

  assert.equal(result.code, 1);
  assert.equal(stub.requests.length, 0);
  assert.match(result.stderr, /Authentication required/);
});

test('--token flag wins over the environment', async () => {
  stub.setRoutes({ 'GET /api/v1/teams': { body: { data: [] } } });

  const result = await runCli(['teams', 'list', '--token', 'flag-token'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(stub.lastRequest().headers.authorization, 'Bearer flag-token');
});

test('validation errors from the API are listed per field', async () => {
  stub.setRoutes({
    'POST /api/v1/groups': {
      status: 422,
      body: { message: 'The name field is required.', errors: { name: ['The name field is required.'] } }
    }
  });

  const result = await runCli(['groups', 'create', '--name', 'x'], { stub });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /API Error \(422\)/);
  assert.match(result.stderr, /name: The name field is required\./);
});
