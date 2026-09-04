const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatOutput,
  formatInterval,
  formatMonitorsTable,
  formatMonitorDetails,
  formatIncidentsTable,
  formatGlobalCheck,
  formatKeyValue
} = require('../src/utils/formatter');
const { buildUpdatePayload } = require('../src/commands/monitors');

test('formatOutput returns pretty JSON for json and the raw value otherwise', () => {
  const data = { a: 1, b: [1, 2] };
  assert.equal(formatOutput(data, 'json'), JSON.stringify(data, null, 2));
  assert.equal(formatOutput(data, 'table'), data);
});

test('formatInterval renders sub-minute intervals in seconds', () => {
  assert.equal(formatInterval(0.5), '30s');
  assert.equal(formatInterval(1), '1m');
  assert.equal(formatInterval(5), '5m');
  assert.equal(formatInterval(null), '-');
});

test('formatMonitorsTable includes name, type, and interval columns', () => {
  const output = formatMonitorsTable([
    { id: 1, friendly_name: 'API', url: 'https://api.example.com', monitor_type: 'http', status: 'online', check_interval: 0.5, is_paused: false, last_checked_at: null }
  ]);

  assert.match(output, /API/);
  assert.match(output, /https:\/\/api\.example\.com/);
  assert.match(output, /http/);
  assert.match(output, /30s/);
  assert.match(output, /Never/);
});

test('formatMonitorDetails shows push schedule for heartbeat monitors and payment expectations', () => {
  const push = formatMonitorDetails({
    id: 2, friendly_name: 'Backup', monitor_type: 'heartbeat', status: 'online', heartbeat_interval: 3600, heartbeat_grace: 60, ping_url: 'https://sentinel.test/ping/abc'
  });
  assert.match(push, /Heartbeat Interval/);
  assert.match(push, /3600 seconds/);
  assert.match(push, /Ping URL/);
  assert.doesNotMatch(push, /Check Interval/);

  const paid = formatMonitorDetails({
    id: 3, url: 'https://pay.example.com', monitor_type: 'http', status: 'pending', check_interval: 1,
    check_types: ['payment'], payment_settings: { expected: { amount: '0.02', network: 'eip155:8453' } }
  });
  assert.match(paid, /Payment Expected/);
  assert.match(paid, /eip155:8453/);
});

test('formatIncidentsTable marks open incidents as ongoing', () => {
  const output = formatIncidentsTable([
    { id: 1, monitor: { url: 'https://example.com' }, status: 'open', started_at: '2026-09-01', duration: null }
  ]);
  assert.match(output, /Ongoing/);
});

test('formatGlobalCheck renders one row per region and the verdict line', () => {
  const output = formatGlobalCheck({
    url: 'https://example.com',
    checked_at: '2026-09-02T12:00:00+00:00',
    verdict: 'partial',
    reachable_regions: 1,
    total_regions: 2,
    results: [
      { region: 'ash', name: 'Ashburn', status: 'online', status_code: 200, response_time_ms: 100, dns_ms: 1, tcp_ms: 2, tls_ms: 3, ttfb_ms: 90, error: null },
      { region: 'sin', name: 'Singapore', status: 'offline', status_code: null, response_time_ms: null, dns_ms: null, tcp_ms: null, tls_ms: null, ttfb_ms: null, error: 'timeout' }
    ]
  });

  assert.match(output, /Ashburn/);
  assert.match(output, /Singapore/);
  assert.match(output, /timeout/);
  assert.match(output, /Verdict: PARTIAL/);
  assert.match(output, /1 of 2 regions reached https:\/\/example\.com/);
});

test('formatKeyValue prints each key', () => {
  const output = formatKeyValue({ Name: 'Ada', Email: 'ada@example.com' });
  assert.match(output, /Name/);
  assert.match(output, /ada@example\.com/);
});

test('buildUpdatePayload implies a check type from a settings object', () => {
  const current = { monitor_type: 'http', url: 'https://example.com', check_types: ['ssl'] };
  const payload = buildUpdatePayload(current, { keyword_settings: { keywords: [] } });

  assert.deepEqual(payload, {
    keyword_settings: { keywords: [] },
    url: 'https://example.com',
    check_types: ['ssl']
  });
});

test('buildUpdatePayload keeps the port for port monitors', () => {
  const current = { monitor_type: 'port', url: 'db.example.com', port: 5432, check_types: [] };
  const payload = buildUpdatePayload(current, { check_interval: 5 });

  assert.deepEqual(payload, { check_interval: 5, url: 'db.example.com', port: 5432, check_types: [] });
});
