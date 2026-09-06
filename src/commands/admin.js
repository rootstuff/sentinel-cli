const { Command } = require('commander');
const chalk = require('chalk');
const Table = require('cli-table3');
const { formatOutput } = require('../utils/formatter');
const { withCommonOptions, runAction } = require('../utils/command');
const ApiClient = require('../api/client');

/**
 * Operator commands. They call /api/v1/admin/*, which only answers a super
 * admin using a token that carries the `admin` ability (minted with
 * `php artisan admin:token`). That token is usually kept apart from the
 * everyday one, so SENTINEL_ADMIN_TOKEN is honoured ahead of SENTINEL_TOKEN
 * and the config file; --token still wins over everything.
 */
function operatorOptions(options) {
  if (!options.token && process.env.SENTINEL_ADMIN_TOKEN) {
    return { ...options, token: process.env.SENTINEL_ADMIN_TOKEN };
  }

  return options;
}

function seconds(value) {
  return value === null || value === undefined ? '-' : `${value}s`;
}

function formatCadenceTable(report) {
  const table = new Table({
    head: ['Monitor', 'URL', 'Region', 'Checks', 'Expected', 'Max gap', 'Mean gap'].map(h => chalk.cyan(h)),
    colWidths: [9, 42, 8, 8, 10, 9, 10]
  });

  report.monitors.forEach(monitor => {
    Object.entries(monitor.regions).forEach(([region, stats]) => {
      const short = stats.expected > 0 && stats.checks < stats.expected * 0.9;
      table.push([
        monitor.monitor_id,
        monitor.url,
        region,
        short ? chalk.red(stats.checks) : chalk.green(stats.checks),
        stats.expected,
        seconds(stats.max_gap_seconds),
        seconds(stats.mean_gap_seconds)
      ]);
    });
  });

  return table.toString();
}

function formatIncidentsTable(report) {
  const table = new Table({
    head: ['Root cause', 'Opened', 'Still open', 'Latest'].map(h => chalk.cyan(h)),
    colWidths: [60, 8, 12, 27]
  });

  report.by_root_cause.forEach(row => {
    table.push([row.root_cause || '-', row.opened, row.still_open, row.latest_at]);
  });

  return table.toString();
}

function formatLatestIncidents(report) {
  const table = new Table({
    head: ['ID', 'URL', 'Root cause', 'Started', 'Ended'].map(h => chalk.cyan(h)),
    colWidths: [8, 40, 36, 22, 22]
  });

  report.latest.forEach(incident => {
    table.push([incident.id, incident.url || '-', incident.root_cause || '-', incident.started_at, incident.ended_at || chalk.yellow('open')]);
  });

  return table.toString();
}

function formatFreshnessTable(report) {
  const table = new Table({
    head: ['Region', 'Monitors', 'Stale', 'Oldest lag'].map(h => chalk.cyan(h)),
    colWidths: [10, 10, 8, 12]
  });

  Object.entries(report.regions).forEach(([region, stats]) => {
    table.push([
      region,
      stats.monitors,
      stats.stale > 0 ? chalk.red(stats.stale) : chalk.green(stats.stale),
      seconds(stats.oldest_lag_seconds)
    ]);
  });

  return table.toString();
}

function formatQueueWaits(waits) {
  const entries = Object.entries(waits);
  if (entries.length === 0) {
    return chalk.gray('No queue wait data (Horizon not reachable from the API).');
  }

  const table = new Table({
    head: ['Queue', 'Wait'].map(h => chalk.cyan(h)),
    colWidths: [24, 10]
  });
  entries.forEach(([queue, wait]) => {
    table.push([queue, wait > 30 ? chalk.red(seconds(wait)) : seconds(wait)]);
  });

  return table.toString();
}

function formatApiErrorsTable(report) {
  const table = new Table({
    head: ['Method', 'Path', 'Status', 'Requests', 'Users', 'Latest'].map(h => chalk.cyan(h)),
    colWidths: [8, 44, 8, 10, 7, 27]
  });

  report.by_path.forEach(row => {
    table.push([row.method, row.path, row.status_code, row.requests, row.users, row.latest_at]);
  });

  return table.toString();
}

function formatAbuseSections(report) {
  const out = [];

  out.push(chalk.cyan.bold(`\nFlagged monitors (${report.flagged_monitors.length}):`));
  if (report.flagged_monitors.length === 0) {
    out.push(chalk.gray('  none'));
  } else {
    const table = new Table({ head: ['Monitor', 'URL', 'Threat', 'Flagged', 'Owner'].map(h => chalk.cyan(h)), colWidths: [9, 40, 20, 22, 30] });
    report.flagged_monitors.forEach(row => {
      table.push([row.monitor_id, row.url, row.threat, row.flagged_at || '-', row.owner ? row.owner.email : '-']);
    });
    out.push(table.toString());
  }

  out.push(chalk.cyan.bold(`\nUnverified accounts holding monitors (${report.unverified_users_with_monitors.length}):`));
  if (report.unverified_users_with_monitors.length === 0) {
    out.push(chalk.gray('  none'));
  } else {
    const table = new Table({ head: ['User', 'Email', 'Monitors', 'Signed up'].map(h => chalk.cyan(h)), colWidths: [8, 36, 10, 27] });
    report.unverified_users_with_monitors.forEach(row => {
      table.push([row.user_id, row.email, row.monitors, row.signed_up_at]);
    });
    out.push(table.toString());
  }

  out.push(chalk.cyan.bold(`\nHosts monitored by several teams (${report.hosts_monitored_by_multiple_teams.length}):`));
  if (report.hosts_monitored_by_multiple_teams.length === 0) {
    out.push(chalk.gray('  none'));
  } else {
    const table = new Table({ head: ['Host', 'Monitors', 'Teams'].map(h => chalk.cyan(h)), colWidths: [44, 10, 8] });
    report.hosts_monitored_by_multiple_teams.forEach(row => {
      table.push([row.host, row.monitors, row.teams]);
    });
    out.push(table.toString());
  }

  return out.join('\n');
}

function formatFailedJobsTable(report) {
  const table = new Table({
    head: ['Queue', 'Error', 'Failures', 'Latest'].map(h => chalk.cyan(h)),
    colWidths: [20, 64, 10, 27],
    wordWrap: true
  });

  report.by_error.forEach(row => {
    table.push([row.queue, row.error, row.failures, row.latest_at]);
  });

  return table.toString();
}

function createAdminCommands() {
  const admin = new Command('admin')
    .description('Operator reports across every team (super admin token with the admin ability)');

  withCommonOptions(
    admin.command('cadence')
      .description('Checks delivered per region for 30-second monitors, with gap statistics')
      .option('--monitor-id <id>', 'Report on one monitor instead of sampling the tier')
      .option('--minutes <n>', 'Window in minutes (default 10, max 1440)')
      .option('--interval <minutes>', 'Interval to sample when no monitor is given (default 0.5)')
      .option('--limit <n>', 'Max monitors when sampling (default 50)')
  ).action(runAction(async (options) => {
    const client = new ApiClient(operatorOptions(options));
    const params = {};
    if (options.monitorId) params.monitor_id = Number(options.monitorId);
    if (options.minutes) params.minutes = Number(options.minutes);
    if (options.interval) params.interval = Number(options.interval);
    if (options.limit) params.limit = Number(options.limit);

    const report = await client.adminCadence(params);

    if (options.format === 'json') {
      console.log(formatOutput(report, 'json'));
      return;
    }

    console.log(chalk.cyan.bold(`\nCadence over the last ${report.window_minutes} minutes (${report.monitors.length} monitors):\n`));
    console.log(formatCadenceTable(report));
  }));

  withCommonOptions(
    admin.command('incidents')
      .description('Incidents opened across all teams, grouped by root cause')
      .option('--hours <n>', 'Window in hours (default 2)')
      .option('--contains <text>', 'Only root causes containing this text')
      .option('--examples <n>', 'How many of the newest incidents to list (default 10)')
  ).action(runAction(async (options) => {
    const client = new ApiClient(operatorOptions(options));
    const params = {};
    if (options.hours) params.hours = Number(options.hours);
    if (options.contains) params.contains = options.contains;
    if (options.examples) params.examples = Number(options.examples);

    const report = await client.adminIncidents(params);

    if (options.format === 'json') {
      console.log(formatOutput(report, 'json'));
      return;
    }

    console.log(chalk.cyan.bold(`\n${report.total_opened} incidents opened in the last ${report.window_hours} hours:\n`));
    console.log(formatIncidentsTable(report));
    if (report.latest.length > 0) {
      console.log(chalk.cyan.bold('\nNewest:\n'));
      console.log(formatLatestIncidents(report));
    }
  }));

  withCommonOptions(
    admin.command('freshness')
      .description('Stale monitors per region and Horizon queue waits (the post-deploy check)')
  ).action(runAction(async (options) => {
    const client = new ApiClient(operatorOptions(options));
    const report = await client.adminFreshness();

    if (options.format === 'json') {
      console.log(formatOutput(report, 'json'));
      return;
    }

    console.log(chalk.cyan.bold('\nRegion freshness:\n'));
    console.log(formatFreshnessTable(report));
    Object.entries(report.regions).forEach(([region, stats]) => {
      (stats.stale_monitors || []).forEach(row => {
        console.log(chalk.yellow(`  ${region}: monitor ${row.monitor_id} ${row.url} last checked ${row.last_checked_at} (${row.lag_seconds}s ago, interval ${row.check_interval_seconds}s)`));
      });
    });
    console.log(chalk.cyan.bold('\nQueue waits:\n'));
    console.log(formatQueueWaits(report.queue_wait_seconds));
  }));

  withCommonOptions(
    admin.command('api-errors')
      .description('API and MCP requests answering 4xx/5xx, grouped by path and status')
      .option('--hours <n>', 'Window in hours (default 24)')
      .option('--limit <n>', 'Max groups (default 25)')
  ).action(runAction(async (options) => {
    const client = new ApiClient(operatorOptions(options));
    const params = {};
    if (options.hours) params.hours = Number(options.hours);
    if (options.limit) params.limit = Number(options.limit);

    const report = await client.adminApiErrors(params);

    if (options.format === 'json') {
      console.log(formatOutput(report, 'json'));
      return;
    }

    console.log(chalk.cyan.bold(`\n${report.error_requests} errors in ${report.total_requests} requests over ${report.window_hours} hours (${report.error_rate_pct}%):\n`));
    console.log(formatApiErrorsTable(report));
  }));

  withCommonOptions(
    admin.command('abuse')
      .description('What needs an abuse review: flagged monitors, unverified accounts with monitors, shared hosts')
      .option('--limit <n>', 'Max rows per section (default 20)')
  ).action(runAction(async (options) => {
    const client = new ApiClient(operatorOptions(options));
    const params = {};
    if (options.limit) params.limit = Number(options.limit);

    const report = await client.adminAbuse(params);

    if (options.format === 'json') {
      console.log(formatOutput(report, 'json'));
      return;
    }

    console.log(formatAbuseSections(report));
  }));

  withCommonOptions(
    admin.command('failed-jobs')
      .description('Failed queue jobs grouped by queue and exception')
      .option('--hours <n>', 'Window in hours (default 12)')
      .option('--limit <n>', 'Max groups (default 20)')
  ).action(runAction(async (options) => {
    const client = new ApiClient(operatorOptions(options));
    const params = {};
    if (options.hours) params.hours = Number(options.hours);
    if (options.limit) params.limit = Number(options.limit);

    const report = await client.adminFailedJobs(params);

    if (options.format === 'json') {
      console.log(formatOutput(report, 'json'));
      return;
    }

    console.log(chalk.cyan.bold(`\n${report.total_failures} failed jobs in the last ${report.window_hours} hours:\n`));
    console.log(formatFailedJobsTable(report));
  }));

  return admin;
}

module.exports = createAdminCommands;
