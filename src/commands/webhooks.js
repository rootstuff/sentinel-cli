const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const Table = require('cli-table3');
const { formatOutput, formatKeyValue } = require('../utils/formatter');
const { withCommonOptions, runAction, parseListFlag } = require('../utils/command');
const ApiClient = require('../api/client');

const AUTH_TYPES = 'none, bearer, header, basic';
const SEVERITIES = 'critical, warning, info';

function formatWebhooksTable(endpoints) {
  const table = new Table({
    head: ['ID', 'Name', 'Host', 'Auth', 'Severities', 'Active', 'Last Delivered'].map(h => chalk.cyan(h)),
    colWidths: [8, 22, 28, 9, 26, 8, 22]
  });

  endpoints.forEach(endpoint => {
    table.push([
      endpoint.id,
      endpoint.name,
      endpoint.url_host || '-',
      endpoint.auth_type,
      (endpoint.severities || []).join(', ') || '-',
      endpoint.is_active ? chalk.green('Yes') : chalk.yellow('No'),
      endpoint.last_delivered_at || 'Never'
    ]);
  });

  return table.toString();
}

function formatWebhookDetails(endpoint) {
  return formatKeyValue({
    'ID': endpoint.id,
    'Name': endpoint.name,
    'Host': endpoint.url_host || '-',
    'Auth Type': endpoint.auth_type,
    'Auth Header': endpoint.auth_header_name || '-',
    'Severities': (endpoint.severities || []).join(', ') || '-',
    'Active': endpoint.is_active ? 'Yes' : 'No',
    'Last Delivered': endpoint.last_delivered_at || 'Never',
    'Created': endpoint.created_at
  });
}

/**
 * Map the shared create/update flags onto the API payload. Secret-carrying
 * fields (url, auth_token, signing_secret) are write-only on the API, so
 * they are only sent when the flag was given.
 */
function payloadFromOptions(options) {
  const data = {};

  if (options.name !== undefined) data.name = options.name;
  if (options.url !== undefined) data.url = options.url;
  if (options.authType !== undefined) data.auth_type = options.authType;
  if (options.authToken !== undefined) data.auth_token = options.authToken;
  if (options.authHeaderName !== undefined) data.auth_header_name = options.authHeaderName;
  if (options.signingSecret !== undefined) data.signing_secret = options.signingSecret;
  if (options.severities !== undefined) data.severities = parseListFlag(options.severities);
  if (options.active === true) data.is_active = true;
  if (options.active === false) data.is_active = false;

  return data;
}

function addPayloadOptions(command) {
  return command
    .option('--name <name>', 'Display name (max 100 chars)')
    .option('--url <url>', 'HTTPS URL to deliver alerts to (write-only, never returned)')
    .option('--auth-type <type>', `Authentication scheme (${AUTH_TYPES})`)
    .option('--auth-token <token>', 'Bearer token, basic credentials, or header value (write-only)')
    .option('--auth-header-name <name>', 'Header name when --auth-type header')
    .option('--signing-secret <secret>', 'HMAC signing secret, 16+ chars (write-only)')
    .option('--severities <list>', `Comma-separated severities to deliver (${SEVERITIES}); default all`)
    .option('--active', 'Enable deliveries')
    .option('--no-active', 'Disable deliveries');
}

function createWebhooksCommands() {
  const webhooks = new Command('webhooks')
    .description('Outbound webhook endpoint commands (alert destinations)');

  withCommonOptions(webhooks.command('list').alias('ls').description('List webhook endpoints'))
    .action(runAction(async (options) => {
      const client = new ApiClient(options);
      const result = await client.listWebhookEndpoints();

      if (options.format === 'json') {
        console.log(formatOutput(result, 'json'));
        return;
      }

      if (result.data.length === 0) {
        console.log(chalk.yellow('No webhook endpoints configured.'));
        return;
      }

      console.log(chalk.cyan.bold(`\nWebhook Endpoints (${result.total} total):\n`));
      console.log(formatWebhooksTable(result.data));
    }));

  withCommonOptions(webhooks.command('get <id>').description('Get details for a webhook endpoint'))
    .action(runAction(async (id, options) => {
      const client = new ApiClient(options);
      const endpoint = await client.getWebhookEndpoint(id);

      if (options.format === 'json') {
        console.log(formatOutput(endpoint, 'json'));
        return;
      }

      console.log(chalk.cyan.bold('\nWebhook Endpoint:\n'));
      console.log(formatWebhookDetails(endpoint));
    }));

  withCommonOptions(
    addPayloadOptions(webhooks.command('create').description('Create a webhook endpoint')),
    { formatDefault: 'table' }
  ).action(runAction(async (options) => {
    const data = payloadFromOptions(options);

    if (!data.name || !data.url) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Endpoint name:',
          when: !data.name,
          validate: (input) => input.trim().length > 0 || 'Name is required'
        },
        {
          type: 'input',
          name: 'url',
          message: 'HTTPS URL:',
          when: !data.url,
          validate: (input) => input.startsWith('https://') || 'The URL must use https'
        }
      ]);
      if (answers.name) data.name = answers.name;
      if (answers.url) data.url = answers.url;
    }

    if (!data.auth_type) data.auth_type = 'none';

    const client = new ApiClient(options);
    const endpoint = await client.createWebhookEndpoint(data);

    if (options.format === 'json') {
      console.log(formatOutput(endpoint, 'json'));
      return;
    }

    console.log(chalk.green('✓ Webhook endpoint created successfully!\n'));
    console.log(formatWebhookDetails(endpoint));
  }));

  withCommonOptions(
    addPayloadOptions(webhooks.command('update <id>').description('Update a webhook endpoint (omitted secrets keep their stored values)')),
    { formatDefault: 'table' }
  ).action(runAction(async (id, options) => {
    const data = payloadFromOptions(options);

    if (Object.keys(data).length === 0) {
      throw new Error('At least one field must be provided to update.');
    }

    const client = new ApiClient(options);

    // name and auth_type are required by the API on every update, so fill
    // them from the stored endpoint when the caller did not change them.
    const current = await client.getWebhookEndpoint(id);
    if (data.name === undefined) data.name = current.name;
    if (data.auth_type === undefined) data.auth_type = current.auth_type;
    if (data.auth_type === 'header' && data.auth_header_name === undefined && current.auth_header_name) {
      data.auth_header_name = current.auth_header_name;
    }

    const endpoint = await client.updateWebhookEndpoint(id, data);

    if (options.format === 'json') {
      console.log(formatOutput(endpoint, 'json'));
      return;
    }

    console.log(chalk.green('✓ Webhook endpoint updated successfully!\n'));
    console.log(formatWebhookDetails(endpoint));
  }));

  withCommonOptions(
    webhooks.command('delete <id>').alias('rm').description('Delete a webhook endpoint').option('--yes', 'Skip confirmation prompt'),
    { format: false }
  ).action(runAction(async (id, options) => {
    if (!options.yes) {
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Are you sure you want to delete webhook endpoint ${id}?`,
          default: false
        }
      ]);

      if (!answers.confirm) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }

    const client = new ApiClient(options);
    await client.deleteWebhookEndpoint(id);

    console.log(chalk.green(`✓ Webhook endpoint ${id} deleted successfully.`));
  }));

  withCommonOptions(webhooks.command('test <id>').description('Send a sample alert payload to a webhook endpoint'), { format: false })
    .action(runAction(async (id, options) => {
      const client = new ApiClient(options);

      console.log(chalk.cyan(`Sending test payload to webhook endpoint ${id}...`));
      const result = await client.testWebhookEndpoint(id);

      console.log(chalk.green(`✓ ${result.message}`));
    }));

  return webhooks;
}

module.exports = createWebhooksCommands;
