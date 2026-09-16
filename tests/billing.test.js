const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startStub, runCli, assertRequest } = require('./helpers');

let stub;
before(async () => { stub = await startStub(); });
after(() => stub.close());

const billing = {
  plan: 'business',
  billing_recipients: ['accounting@example.com'],
  billing_information: {
    company: 'Example Company LLC',
    address: { line1: '1 Main St', city: 'Sacramento', state: 'CA', postal_code: '95814', country: 'US' },
    tax_id_type: 'us_ein',
    tax_id: '12-3456789'
  },
  tax_id_types: { us_ein: 'US EIN', eu_vat: 'EU VAT' }
};

test('billing get renders recipients and information', async () => {
  stub.setRoutes({ 'GET /api/v1/billing': { body: { data: billing } } });

  const result = await runCli(['billing', 'get'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assertRequest(stub.lastRequest(), 'GET', '/api/v1/billing');
  assert.match(result.stdout, /accounting@example.com/);
  assert.match(result.stdout, /Example Company LLC/);
  assert.match(result.stdout, /12-3456789 \(US EIN\)/);
});

test('billing recipients replaces the list', async () => {
  stub.setRoutes({ 'PUT /api/v1/billing': { body: { data: { ...billing, billing_recipients: ['a@example.com', 'b@example.com'] } } } });

  const result = await runCli(['billing', 'recipients', 'a@example.com', 'b@example.com'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const request = stub.lastRequest();
  assertRequest(request, 'PUT', '/api/v1/billing');
  assert.deepEqual(request.body, { billing_recipients: ['a@example.com', 'b@example.com'] });
  assert.match(result.stdout, /Billing recipients saved/);
});

test('billing recipients --clear sends an empty list', async () => {
  stub.setRoutes({ 'PUT /api/v1/billing': { body: { data: { ...billing, billing_recipients: [] } } } });

  const result = await runCli(['billing', 'recipients', '--clear'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(stub.lastRequest().body, { billing_recipients: [] });
});

test('billing recipients with nothing to send fails clearly', async () => {
  const result = await runCli(['billing', 'recipients'], { stub });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /one to five email addresses/);
});

test('billing information sends the full block and surfaces a Stripe warning', async () => {
  stub.setRoutes({ 'PUT /api/v1/billing': { body: { data: billing, warning: 'Saved, but Stripe rejected the billing information: Invalid tax ID' } } });

  const result = await runCli(['billing', 'information', '--company', 'Example Company LLC', '--line1', '1 Main St', '--country', 'us', '--tax-id-type', 'us_ein', '--tax-id', '12-3456789'], { stub });

  assert.equal(result.code, 0, result.stderr);
  const body = stub.lastRequest().body;
  assert.equal(body.billing_information.company, 'Example Company LLC');
  assert.equal(body.billing_information.address.line1, '1 Main St');
  assert.equal(body.billing_information.address.city, '');
  assert.equal(body.billing_information.tax_id, '12-3456789');
  assert.match(result.stdout, /Stripe rejected/);
});

test('billing get --format json passes the payload through', async () => {
  stub.setRoutes({ 'GET /api/v1/billing': { body: { data: billing } } });

  const result = await runCli(['billing', 'get', '--format', 'json'], { stub });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).billing_information.company, 'Example Company LLC');
});
