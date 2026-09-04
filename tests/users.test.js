const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

const member = {
  id: 11,
  name: 'Grace Hopper',
  email: 'grace@example.com',
  role: 'editor',
  status: 'active',
  mfa_enabled: true,
  created_at: '2026-01-01T00:00:00+00:00',
  added_at: '2026-02-01T00:00:00+00:00',
  last_login_at: '2026-09-01T08:00:00+00:00'
};

const invitation = {
  id: 3,
  email: 'new@example.com',
  role: 'viewer',
  created_at: '2026-09-01T00:00:00+00:00',
  expires_at: '2026-09-08T00:00:00+00:00'
};

test('users list', async () => {
  stub.setRoutes({ 'GET /api/v1/users': { body: { team: 'Acme', total: 1, data: [member] } } });

  const result = await runCli(['users', 'list'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/users');
  assert.match(result.stdout, /Team "Acme" \(1 members\)/);
  assert.match(result.stdout, /grace@example\.com/);
});

test('users list --format json', async () => {
  stub.setRoutes({ 'GET /api/v1/users': { body: { team: 'Acme', total: 1, data: [member] } } });

  const result = await runCli(['users', 'list', '--format', 'json'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data[0].role, 'editor');
});

test('users invite posts email and role', async () => {
  stub.setRoutes({ 'POST /api/v1/users/invitations': { status: 201, body: invitation } });

  const result = await runCli(['users', 'invite', 'new@example.com', '--role', 'viewer'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'POST', '/api/v1/users/invitations');
  assert.deepEqual(request.body, { email: 'new@example.com', role: 'viewer' });
  assert.match(result.stdout, /Invitation sent to new@example\.com as viewer/);
});

test('users set-role PUTs the role', async () => {
  stub.setRoutes({ 'PUT /api/v1/users/11': { body: { ...member, role: 'admin' } } });

  const result = await runCli(['users', 'set-role', '11', 'admin'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'PUT', '/api/v1/users/11');
  assert.deepEqual(request.body, { role: 'admin' });
  assert.match(result.stdout, /Grace Hopper is now admin/);
});

test('users remove --yes DELETEs the member', async () => {
  stub.setRoutes({ 'DELETE /api/v1/users/11': { status: 204 } });

  const result = await runCli(['users', 'remove', '11', '--yes'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'DELETE', '/api/v1/users/11');
  assert.match(result.stdout, /Member 11 removed/);
});

test('users invitations list', async () => {
  stub.setRoutes({ 'GET /api/v1/users/invitations': { body: { total: 1, data: [invitation] } } });

  const result = await runCli(['users', 'invitations', 'list'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/users/invitations');
  assert.match(result.stdout, /Pending Invitations \(1\)/);
  assert.match(result.stdout, /new@example\.com/);
});

test('users invitations set-role and cancel', async () => {
  stub.setRoutes({
    'PUT /api/v1/users/invitations/3': { body: { ...invitation, role: 'editor' } },
    'DELETE /api/v1/users/invitations/3': { status: 204 }
  });

  let result = await runCli(['users', 'invitations', 'set-role', '3', 'editor'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'PUT', '/api/v1/users/invitations/3');
  assert.deepEqual(stub.lastRequest().body, { role: 'editor' });
  assert.match(result.stdout, /now grants the editor role/);

  result = await runCli(['users', 'invitations', 'cancel', '3', '--yes'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'DELETE', '/api/v1/users/invitations/3');
  assert.match(result.stdout, /Invitation 3 cancelled/);
});

test('the owner cannot be re-roled: API 422 is shown', async () => {
  stub.setRoutes({ 'PUT /api/v1/users/1': { status: 422, body: { message: "The team owner's role cannot be changed." } } });

  const result = await runCli(['users', 'set-role', '1', 'viewer'], { stub });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /owner's role cannot be changed/);
});
