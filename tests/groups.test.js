const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

const group = {
  id: 5,
  name: 'Production',
  description: 'Customer-facing services',
  parent_id: null,
  sort_order: 1,
  monitors_count: 3,
  created_at: '2026-01-01T00:00:00+00:00',
  updated_at: '2026-01-01T00:00:00+00:00'
};

test('groups list renders a table', async () => {
  stub.setRoutes({ 'GET /api/v1/groups': { body: { total: 1, data: [group] } } });

  const result = await runCli(['groups', 'list'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/groups');
  assert.match(result.stdout, /Groups \(1 total\)/);
  assert.match(result.stdout, /Production/);
});

test('groups list --format json', async () => {
  stub.setRoutes({ 'GET /api/v1/groups': { body: { total: 1, data: [group] } } });

  const result = await runCli(['groups', 'ls', '--format', 'json'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data[0].name, 'Production');
});

test('groups get', async () => {
  stub.setRoutes({ 'GET /api/v1/groups/5': { body: group } });

  const result = await runCli(['groups', 'get', '5'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/groups/5');
  assert.match(result.stdout, /Customer-facing services/);
});

test('groups create posts name, description and parent', async () => {
  stub.setRoutes({ 'POST /api/v1/groups': { status: 201, body: group } });

  const result = await runCli(['groups', 'create', '--name', 'Production', '--description', 'Customer-facing services', '--parent-id', '2'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'POST', '/api/v1/groups');
  assert.deepEqual(request.body, { name: 'Production', description: 'Customer-facing services', parent_id: 2 });
  assert.match(result.stdout, /Group created successfully/);
});

test('groups update merges the stored group with the change', async () => {
  stub.setRoutes({
    'GET /api/v1/groups/5': { body: group },
    'PUT /api/v1/groups/5': { body: { ...group, name: 'Prod' } }
  });

  const result = await runCli(['groups', 'update', '5', '--name', 'Prod', '--parent-id', 'none'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.requests[1], 'PUT', '/api/v1/groups/5');
  assert.deepEqual(stub.requests[1].body, { name: 'Prod', description: 'Customer-facing services', parent_id: null });
});

test('groups delete --yes', async () => {
  stub.setRoutes({ 'DELETE /api/v1/groups/5': { status: 204 } });

  const result = await runCli(['groups', 'delete', '5', '--yes'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'DELETE', '/api/v1/groups/5');
  assert.match(result.stdout, /Group 5 deleted/);
});

test('duplicate group names surface the existing id from the API', async () => {
  stub.setRoutes({
    'POST /api/v1/groups': {
      status: 422,
      body: { message: 'A group named "Production" already exists in this team (id 5).', errors: { name: ['taken'] }, existing_group_id: 5 }
    }
  });

  const result = await runCli(['groups', 'create', '--name', 'Production'], { stub });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /already exists in this team \(id 5\)/);
});
