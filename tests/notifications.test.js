const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

const channels = [
  { id: 'slack', type: 'slack', name: 'Slack', enabled: true, configured: true, webhook_url: 'https://hooks.slack.com/services/...' },
  { id: 'email', type: 'email', name: 'Email', enabled: true, configured: true, email: 'ada@example.com' }
];

test('notifications list', async () => {
  stub.setRoutes({ 'GET /api/v1/notification-channels': { body: { data: channels } } });

  const result = await runCli(['notifications', 'list'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/notification-channels');
  assert.match(result.stdout, /Slack/);
  assert.match(result.stdout, /Email/);
});

test('notifications list --format json', async () => {
  stub.setRoutes({ 'GET /api/v1/notification-channels': { body: { data: channels } } });

  const result = await runCli(['notifications', 'list', '--format', 'json'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.length, 2);
});

test('notifications get, create, update, enable, disable, delete, test', async () => {
  stub.setRoutes({
    'GET /api/v1/notification-channels/slack': { body: channels[0] },
    'POST /api/v1/notification-channels': { status: 201, body: channels[0] },
    'PUT /api/v1/notification-channels/sms': { body: { id: 'sms', type: 'sms', name: 'SMS', enabled: false, configured: true } },
    'PUT /api/v1/notification-channels/email': { body: channels[1] },
    'DELETE /api/v1/notification-channels/slack': { status: 204 },
    'POST /api/v1/notification-channels/slack/test': { body: { success: true, message: 'Test notification sent to Slack' } }
  });

  let result = await runCli(['notifications', 'get', 'slack'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/notification-channels/slack');

  result = await runCli(['notifications', 'create', '--type', 'slack', '--webhook-url', 'https://hooks.slack.com/services/x'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'POST', '/api/v1/notification-channels');
  assert.deepEqual(stub.lastRequest().body, { type: 'slack', webhook_url: 'https://hooks.slack.com/services/x' });

  result = await runCli(['notifications', 'update', 'sms', '--phone', '+15555550100', '--enabled', 'false'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'PUT', '/api/v1/notification-channels/sms');
  assert.deepEqual(stub.lastRequest().body, { enabled: false, phone_number: '+15555550100' });

  result = await runCli(['notifications', 'enable', 'email'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(stub.lastRequest().body, { enabled: true });

  result = await runCli(['notifications', 'disable', 'sms'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(stub.lastRequest().body, { enabled: false });

  result = await runCli(['notifications', 'test', 'slack'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'POST', '/api/v1/notification-channels/slack/test');
  assert.match(result.stdout, /Test notification sent to Slack/);

  result = await runCli(['notifications', 'delete', 'slack', '--yes'], { stub });
  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'DELETE', '/api/v1/notification-channels/slack');
});
