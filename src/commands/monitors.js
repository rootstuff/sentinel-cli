const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const {
  formatMonitorsTable,
  formatMonitorDetails,
  formatCheckResult,
  formatOutput
} = require('../utils/formatter');
const {
  withCommonOptions,
  runAction,
  parseJsonFlag,
  parseListFlag
} = require('../utils/command');
const ApiClient = require('../api/client');

const PUSH_TYPES = ['heartbeat', 'cron'];

// Sub-checks whose rules live in a settings object; the object must travel
// with the check type or the API rejects the update.
const SETTINGS_BY_CHECK_TYPE = {
  keyword: 'keyword_settings',
  json: 'json_assertion_settings',
  payment: 'payment_settings',
  lighthouse: 'lighthouse_settings'
};

/**
 * Flags shared by create and update. Every field the v1 API accepts on a
 * monitor is reachable from here; the settings objects take raw JSON.
 */
function addMonitorOptions(command) {
  return command
    .option('--url <url>', 'URL to monitor (bare host for ping/port monitors)')
    .option('--name <name>', 'Friendly name (required for heartbeat/cron monitors)')
    .option('--interval <minutes>', 'Check interval in minutes; 0.5 = every 30 seconds (plan floor applies)')
    .option('--check-types <types>', 'Comma-separated sub-checks: ssl,dns,domain,keyword,json,lighthouse,payment')
    .option('--regions <codes>', 'Comma-separated regions to check from: ash,pdx,nbg,sin (default all)')
    .option('--group-id <id>', 'Monitor group ID, or "none" to ungroup')
    .option('--method <method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)')
    .option('--accepted-status-codes <codes>', 'Comma-separated codes that count as up, e.g. 200,201,3xx')
    .option('--follow-redirects', 'Follow redirects before judging the response')
    .option('--no-follow-redirects', 'Treat a redirect as the final response')
    .option('--timeout <seconds>', 'Request timeout in seconds (1-60)')
    .option('--headers <json>', 'Request headers as a JSON object, e.g. \'{"Authorization":"Bearer x"}\'')
    .option('--body <text>', 'Request body for POST/PUT/PATCH')
    .option('--ssl-threshold <days>', 'Alert when the certificate expires within this many days')
    .option('--domain-threshold <days>', 'Alert when the domain registration expires within this many days')
    .option('--slow-response-threshold <ms>', 'Flag responses slower than this (100-60000 ms)')
    .option('--keyword-settings <json>', 'Keyword check rules, e.g. \'{"keywords":[{"phrase":"OK","mode":"must_contain"}]}\'')
    .option('--json-assertion-settings <json>', 'JSON assertions, e.g. \'{"assertions":[{"path":"status","operator":"equals","value":"ok"}]}\'')
    .option('--payment-settings <json>', 'Agent payment (402) expectations, e.g. \'{"expected":{"amount":"0.02","pay_to":"0x...","network":"eip155:8453"}}\'')
    .option('--lighthouse-settings <json>', 'Lighthouse strategies and score thresholds as JSON')
    .option('--port <number>', 'TCP port (port monitors)')
    .option('--heartbeat-interval <seconds>', 'Expected ping interval in seconds (heartbeat monitors)')
    .option('--cron-expression <expression>', 'Expected schedule (cron monitors)')
    .option('--heartbeat-timezone <tz>', 'Timezone the cron schedule runs in')
    .option('--heartbeat-grace <seconds>', 'Grace period before a missed ping counts as down');
}

/**
 * Translate the flags a caller actually passed into API fields. Anything not
 * passed is left out so the server keeps its stored value.
 */
function payloadFromOptions(options) {
  const data = {};

  if (options.url !== undefined) data.url = options.url;
  if (options.name !== undefined) data.friendly_name = options.name;
  if (options.interval !== undefined) data.check_interval = parseFloat(options.interval);
  if (options.checkTypes !== undefined) data.check_types = parseListFlag(options.checkTypes);
  if (options.regions !== undefined) data.monitored_regions = parseListFlag(options.regions);
  if (options.groupId !== undefined) {
    data.group_id = options.groupId === 'none' ? null : parseInt(options.groupId, 10);
  }
  if (options.method !== undefined) data.http_method = options.method.toUpperCase();
  if (options.acceptedStatusCodes !== undefined) data.accepted_status_codes = parseListFlag(options.acceptedStatusCodes);
  if (options.followRedirects !== undefined) data.follow_redirects = options.followRedirects;
  if (options.timeout !== undefined) data.request_timeout = parseInt(options.timeout, 10);
  if (options.headers !== undefined) data.request_headers = parseJsonFlag(options.headers, '--headers');
  if (options.body !== undefined) data.request_body = options.body;
  if (options.sslThreshold !== undefined) data.ssl_expiry_threshold = parseInt(options.sslThreshold, 10);
  if (options.domainThreshold !== undefined) data.domain_expiry_threshold = parseInt(options.domainThreshold, 10);
  if (options.slowResponseThreshold !== undefined) data.slow_response_threshold = parseInt(options.slowResponseThreshold, 10);
  if (options.keywordSettings !== undefined) data.keyword_settings = parseJsonFlag(options.keywordSettings, '--keyword-settings');
  if (options.jsonAssertionSettings !== undefined) data.json_assertion_settings = parseJsonFlag(options.jsonAssertionSettings, '--json-assertion-settings');
  if (options.paymentSettings !== undefined) data.payment_settings = parseJsonFlag(options.paymentSettings, '--payment-settings');
  if (options.lighthouseSettings !== undefined) data.lighthouse_settings = parseJsonFlag(options.lighthouseSettings, '--lighthouse-settings');
  if (options.port !== undefined) data.port = parseInt(options.port, 10);
  if (options.heartbeatInterval !== undefined) data.heartbeat_interval = parseInt(options.heartbeatInterval, 10);
  if (options.cronExpression !== undefined) data.heartbeat_cron_expression = options.cronExpression;
  if (options.heartbeatTimezone !== undefined) data.heartbeat_timezone = options.heartbeatTimezone;
  if (options.heartbeatGrace !== undefined) data.heartbeat_grace = parseInt(options.heartbeatGrace, 10);

  return data;
}

/**
 * The API validates the whole monitor on update, so the fields it requires
 * (url, check types, the settings behind each active sub-check, the push
 * schedule, the port) are filled from the stored monitor when not overridden.
 */
function buildUpdatePayload(current, changes) {
  const data = { ...changes };
  const isPush = PUSH_TYPES.includes(current.monitor_type);

  if (isPush) {
    delete data.url;
    if (data.friendly_name === undefined) data.friendly_name = current.friendly_name;
    if (current.monitor_type === 'heartbeat' && data.heartbeat_interval === undefined) {
      data.heartbeat_interval = current.heartbeat_interval;
    }
    if (current.monitor_type === 'cron' && data.heartbeat_cron_expression === undefined) {
      data.heartbeat_cron_expression = current.heartbeat_cron_expression;
    }
  } else if (data.url === undefined) {
    data.url = current.url;
  }

  if (current.monitor_type === 'port' && data.port === undefined) {
    data.port = current.port;
  }

  if (data.check_types === undefined) {
    data.check_types = current.check_types || [];
  }

  // A settings object passed without its check type turns the check on
  // (the API infers it), so include those types before pulling defaults.
  const activeTypes = new Set(data.check_types);
  Object.entries(SETTINGS_BY_CHECK_TYPE).forEach(([type, field]) => {
    if (data[field] !== undefined) activeTypes.add(type);
  });

  Object.entries(SETTINGS_BY_CHECK_TYPE).forEach(([type, field]) => {
    if (activeTypes.has(type) && data[field] === undefined && current[field]) {
      data[field] = current[field];
    }
  });

  return data;
}

function createMonitorsCommands() {
  const monitors = new Command('monitors')
    .description('Monitor management commands');

  // List monitors
  withCommonOptions(
    monitors.command('list')
      .alias('ls')
      .description('List all monitors')
      .option('--status <status>', 'Filter by status (online, offline, pending)')
      .option('--type <type>', 'Filter by monitor type (http, ping, port, heartbeat, cron)')
      .option('--interval <minutes>', 'Filter by check interval')
      .option('--search <query>', 'Search monitors by URL')
      .option('--sort <field>', 'Sort by field (url, status, check_interval, last_checked_at, created_at)', 'url')
      .option('--direction <dir>', 'Sort direction (asc, desc)', 'asc')
      .option('--page <number>', 'Page number', '1')
      .option('--per-page <number>', 'Results per page (max 100)', '20')
  ).action(runAction(async (options) => {
    const client = new ApiClient(options);

    const params = {};
    if (options.status) params.status = options.status;
    if (options.type) params.type = options.type;
    if (options.interval) params.interval = options.interval;
    if (options.search) params.search = options.search;
    if (options.sort) params.sort = options.sort;
    if (options.direction) params.direction = options.direction;
    if (options.page) params.page = options.page;
    if (options.perPage) params.per_page = options.perPage;

    const result = await client.listMonitors(params);

    if (options.format === 'json') {
      console.log(formatOutput(result, 'json'));
      return;
    }

    if (result.data.length === 0) {
      console.log(chalk.yellow('No monitors found.'));
      return;
    }

    console.log(chalk.cyan.bold(`\nMonitors (${result.total} total, showing page ${result.current_page} of ${result.last_page}):\n`));
    console.log(formatMonitorsTable(result.data));

    if (result.current_page < result.last_page) {
      console.log(chalk.gray(`\nShowing ${result.from}-${result.to} of ${result.total} monitors. Use --page to see more.`));
    }
  }));

  // Get monitor details
  withCommonOptions(monitors.command('get <id>').description('Get details for a specific monitor'))
    .action(runAction(async (id, options) => {
      const client = new ApiClient(options);
      const monitor = await client.getMonitor(id);

      if (options.format === 'json') {
        console.log(formatOutput(monitor, 'json'));
        return;
      }

      console.log(chalk.cyan.bold('\nMonitor Details:\n'));
      console.log(formatMonitorDetails(monitor));

      if (monitor.response_times && monitor.response_times.length > 0) {
        console.log(chalk.cyan.bold('\n\nLatest Response by Region:\n'));
        monitor.response_times.forEach(entry => {
          console.log(`  ${chalk.cyan(entry.region)}  ${entry.response_time}ms  HTTP ${entry.status_code ?? '-'}  ${entry.checked_at || ''}`);
        });
      }

      if (monitor.incidents && monitor.incidents.length > 0) {
        console.log(chalk.cyan.bold(`\n\nRecent Incidents (${monitor.incidents.length}):\n`));
        monitor.incidents.slice(0, 5).forEach(incident => {
          console.log(`  ${incident.status === 'open' ? chalk.red('●') : chalk.green('●')} ${incident.started_at} - ${incident.status}`);
        });
      }
    }));

  // Create monitor
  withCommonOptions(
    addMonitorOptions(
      monitors.command('create')
        .description('Create a new monitor')
        .option('--type <type>', 'Monitor type: http, ping, port, heartbeat, cron', 'http')
    ),
    { formatDefault: 'table' }
  ).action(runAction(async (options) => {
    const data = payloadFromOptions(options);
    data.monitor_type = options.type;
    const isPush = PUSH_TYPES.includes(data.monitor_type);

    // Prompt for the one field every non-push monitor needs.
    if (!isPush && !data.url) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: data.monitor_type === 'http' ? 'Enter URL to monitor:' : 'Enter host to monitor:',
          validate: (input) => input.trim().length > 0 || 'A URL or host is required'
        }
      ]);
      data.url = answers.url;
    }

    if (isPush && !data.friendly_name) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Enter a name for this monitor:',
          validate: (input) => input.trim().length > 0 || 'A name is required for heartbeat and cron monitors'
        }
      ]);
      data.friendly_name = answers.name;
    }

    const client = new ApiClient(options);
    const monitor = await client.createMonitor(data);

    if (options.format === 'json') {
      console.log(formatOutput(monitor, 'json'));
      return;
    }

    console.log(chalk.green('✓ Monitor created successfully!\n'));
    console.log(formatMonitorDetails(monitor));
  }));

  // Update monitor
  withCommonOptions(
    addMonitorOptions(monitors.command('update <id>').description('Update an existing monitor (only the flags you pass change)')),
    { formatDefault: 'table' }
  ).action(runAction(async (id, options) => {
    const changes = payloadFromOptions(options);

    if (Object.keys(changes).length === 0) {
      throw new Error('At least one field must be provided to update.');
    }

    const client = new ApiClient(options);
    const current = await client.getMonitor(id);
    const data = buildUpdatePayload(current, changes);

    const monitor = await client.updateMonitor(id, data);

    if (options.format === 'json') {
      console.log(formatOutput(monitor, 'json'));
      return;
    }

    console.log(chalk.green('✓ Monitor updated successfully!\n'));
    console.log(formatMonitorDetails(monitor));
  }));

  // Delete monitor
  withCommonOptions(
    monitors.command('delete <id>')
      .alias('rm')
      .description('Delete a monitor')
      .option('--yes', 'Skip confirmation prompt'),
    { format: false }
  ).action(runAction(async (id, options) => {
    if (!options.yes) {
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Are you sure you want to delete monitor ${id}?`,
          default: false
        }
      ]);

      if (!answers.confirm) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }

    const client = new ApiClient(options);
    await client.deleteMonitor(id);

    console.log(chalk.green(`✓ Monitor ${id} deleted successfully.`));
  }));

  // Check monitor now
  withCommonOptions(monitors.command('check <id>').description('Trigger an immediate check for a monitor'), { formatDefault: 'table' })
    .action(runAction(async (id, options) => {
      const client = new ApiClient(options);

      if (options.format !== 'json') {
        console.log(chalk.cyan(`Checking monitor ${id}...`));
      }
      const result = await client.checkMonitor(id);

      if (options.format === 'json') {
        console.log(formatOutput(result, 'json'));
      } else {
        console.log(formatCheckResult(result));
      }
    }));

  // Pause monitor
  withCommonOptions(monitors.command('pause <id>').description('Pause monitoring for a monitor'), { format: false })
    .action(runAction(async (id, options) => {
      const client = new ApiClient(options);
      const result = await client.pauseMonitor(id);

      console.log(chalk.green(`✓ ${result.message}`));
      console.log(chalk.gray(`Monitor ${result.monitor.url} is now paused.`));
    }));

  // Unpause/Resume monitor
  withCommonOptions(
    monitors.command('unpause <id>')
      .alias('resume')
      .description('Resume monitoring for a paused monitor'),
    { format: false }
  ).action(runAction(async (id, options) => {
    const client = new ApiClient(options);
    const result = await client.unpauseMonitor(id);

    console.log(chalk.green(`✓ ${result.message}`));
    console.log(chalk.gray(`Monitor ${result.monitor.url} is now active.`));
  }));

  return monitors;
}

module.exports = createMonitorsCommands;
module.exports.buildUpdatePayload = buildUpdatePayload;
module.exports.payloadFromOptions = payloadFromOptions;
