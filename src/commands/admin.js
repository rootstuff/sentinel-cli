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

  withCommonOptions(
    admin.command('monitors')
      .description('Find monitors in any team')
      .option('--host <text>', 'URL or host fragment')
      .option('--team-id <id>', 'Only this team')
      .option('--owner <email>', 'Owner email fragment')
      .option('--status <status>', 'online, offline, degraded, or pending')
      .option('--interval <minutes>', 'Check interval in minutes (0.5 = 30s)')
      .option('--type <type>', 'http, ping, port, heartbeat, or cron')
      .option('--flagged', 'Only monitors flagged by the abuse gate')
      .option('--paused', 'Only paused monitors')
      .option('--limit <n>', 'Max rows (default 50)')
      .option('--offset <n>', 'Rows to skip')
  ).action(runAction(async (options) => {
    const client = new ApiClient(operatorOptions(options));
    const params = {};
    if (options.host) params.host = options.host;
    if (options.teamId) params.team_id = Number(options.teamId);
    if (options.owner) params.owner = options.owner;
    if (options.status) params.status = options.status;
    if (options.interval) params.interval = Number(options.interval);
    if (options.type) params.type = options.type;
    if (options.flagged) params.flagged = 1;
    if (options.paused) params.paused = 1;
    if (options.limit) params.limit = Number(options.limit);
    if (options.offset) params.offset = Number(options.offset);

    const report = await client.adminMonitors(params);

    if (options.format === 'json') {
      console.log(formatOutput(report, 'json'));
      return;
    }

    console.log(chalk.cyan.bold(`\nMonitors (${report.monitors.length} of ${report.total}):\n`));
    const table = new Table({
      head: ['ID', 'URL', 'Team', 'Owner', 'Interval', 'Status', 'Flag'].map(h => chalk.cyan(h)),
      colWidths: [7, 44, 18, 28, 10, 10, 12]
    });
    report.monitors.forEach(row => {
      table.push([row.monitor_id, row.url, row.team_name || row.team_id || '-', row.owner_email || '-', `${row.check_interval_seconds}s`, row.is_paused ? chalk.gray('paused') : (row.status || '-'), row.safe_browsing_threat || '-']);
    });
    console.log(table.toString());
  }));

  withCommonOptions(
    admin.command('monitor <id>')
      .description('Open one monitor from any team: config, per-region last check, incidents')
  ).action(runAction(async (id, options) => {
    const client = new ApiClient(operatorOptions(options));
    const detail = await client.adminMonitor(id);

    if (options.format === 'json') {
      console.log(formatOutput(detail, 'json'));
      return;
    }

    console.log(chalk.cyan.bold(`\nMonitor ${detail.monitor_id}: ${detail.url}\n`));
    console.log(`Team ${detail.team_name || detail.team_id}, owner ${detail.owner_email || '-'}, ${detail.check_interval_seconds}s ${detail.type}, status ${detail.status}${detail.is_paused ? ' (paused)' : ''}${detail.safe_browsing_threat ? chalk.red(`, flagged ${detail.safe_browsing_threat}`) : ''}`);
    console.log(`Method ${detail.config.method}, timeout ${detail.config.request_timeout_seconds}s, redirects ${detail.config.follow_redirects ? 'followed' : 'not followed'}, checks ${(detail.config.check_types || []).join(', ') || 'uptime'}${detail.config.has_request_headers ? ', custom headers' : ''}${detail.config.auth_type ? `, auth ${detail.config.auth_type}` : ''}`);

    const regions = new Table({ head: ['Region', 'Last check', 'Lag', 'Code', 'Time', 'Error'].map(h => chalk.cyan(h)), colWidths: [8, 27, 8, 6, 9, 40] });
    Object.entries(detail.regions).forEach(([region, r]) => {
      const c = r.latest_check || {};
      regions.push([region, r.last_checked_at || '-', seconds(r.lag_seconds), c.status_code ?? '-', c.response_time_ms != null ? `${c.response_time_ms}ms` : '-', c.error || '-']);
    });
    console.log(regions.toString());

    if (detail.recent_incidents.length > 0) {
      console.log(chalk.cyan.bold('\nRecent incidents:\n'));
      const inc = new Table({ head: ['ID', 'Root cause', 'Started', 'Ended'].map(h => chalk.cyan(h)), colWidths: [8, 50, 22, 22] });
      detail.recent_incidents.forEach(i => inc.push([i.id, i.root_cause || '-', i.started_at, i.ended_at || chalk.yellow('open')]));
      console.log(inc.toString());
    }
  }));

  withCommonOptions(
    admin.command('account')
      .description('Look an account up by email, user id, or team id')
      .option('--email <email>', 'Email (exact or fragment)')
      .option('--user-id <id>', 'User id')
      .option('--team-id <id>', 'Team id (also lists the team members)')
  ).action(runAction(async (options) => {
    const client = new ApiClient(operatorOptions(options));
    const params = {};
    if (options.email) params.email = options.email;
    if (options.userId) params.user_id = Number(options.userId);
    if (options.teamId) params.team_id = Number(options.teamId);
    if (Object.keys(params).length === 0) {
      throw new Error('Pass --email, --user-id, or --team-id.');
    }

    const account = await client.adminAccount(params);

    if (options.format === 'json') {
      console.log(formatOutput(account, 'json'));
      return;
    }

    const u = account.user;
    console.log(chalk.cyan.bold(`\n${u.name} <${u.email}> (user ${u.id})\n`));
    console.log(`Signed up ${u.signed_up_at}, last login ${u.last_login_at || 'never'}, ${u.email_verified ? 'verified' : chalk.yellow('unverified')}, 2FA ${u.two_factor ? 'on' : chalk.yellow('off')}${u.suspended_at ? chalk.red(`, suspended ${u.suspended_at} (${u.suspended_reason || 'no reason'})`) : ''}${u.is_super_admin ? ', super admin' : ''}`);
    const plan = account.plan;
    console.log(`Plan ${plan.type} via ${plan.plan_owner_email}${plan.subscription ? ` (${plan.subscription.type}, ${plan.subscription.status}${plan.subscription.comped ? ', comped' : ''}${plan.subscription.trial_ends_at ? `, trial ends ${plan.subscription.trial_ends_at}` : ''})` : ''}`);

    if (account.teams.length > 0) {
      const teams = new Table({ head: ['Team', 'Name', 'Role', 'Monitors', 'Members'].map(h => chalk.cyan(h)), colWidths: [7, 30, 9, 10, 9] });
      account.teams.forEach(t => teams.push([t.team_id, t.name, t.role, t.monitors, t.members]));
      console.log(teams.toString());
    }
    if (account.tokens.length > 0) {
      const tokens = new Table({ head: ['Token', 'Name', 'Abilities', 'Last used'].map(h => chalk.cyan(h)), colWidths: [7, 30, 30, 27] });
      account.tokens.forEach(t => tokens.push([t.id, t.name, (t.abilities || []).join(', '), t.last_used_at || 'never']));
      console.log(tokens.toString());
    }
    if (account.signup) {
      const s = account.signup;
      console.log(`Signup: ${s.outcome}, source ${s.utm_source || '-'}, landed on ${s.landing_path || '-'}, from ${s.country || '-'}, form ${s.form_ms != null ? `${s.form_ms}ms` : '-'}`);
    }
    if (account.team) {
      console.log(chalk.cyan.bold(`\nTeam ${account.team.team_id}: ${account.team.name} (${account.team.monitors} monitors)\n`));
      const members = new Table({ head: ['User', 'Email', 'Role', '2FA'].map(h => chalk.cyan(h)), colWidths: [7, 36, 9, 6] });
      account.team.members.forEach(m => members.push([m.id, m.email, m.role, m.two_factor ? 'on' : 'off']));
      console.log(members.toString());
    }
  }));

  withCommonOptions(
    admin.command('queues')
      .description('Queue depth, oldest pending age, and workers per box on every monitoring queue')
  ).action(runAction(async (options) => {
    const client = new ApiClient(operatorOptions(options));
    const report = await client.adminQueues();

    if (options.format === 'json') {
      console.log(formatOutput(report, 'json'));
      return;
    }

    console.log(chalk.cyan.bold('\nQueues:\n'));
    const table = new Table({ head: ['Queue', 'Pending', 'Delayed', 'Reserved', 'Oldest', 'Workers'].map(h => chalk.cyan(h)), colWidths: [22, 9, 9, 10, 9, 40] });
    Object.entries(report.queues).forEach(([queue, q]) => {
      const workers = Object.entries(q.workers || {}).map(([box, n]) => `${box}:${n}`).join(' ') || '-';
      const pending = q.pending == null ? '-' : (q.pending > 50 ? chalk.red(q.pending) : q.pending);
      table.push([queue, pending, q.delayed ?? '-', q.reserved ?? '-', seconds(q.oldest_pending_age_seconds), workers]);
    });
    console.log(table.toString());
  }));

  withCommonOptions(
    admin.command('signups')
      .description('Recent accounts with attribution, plus blocked signup attempts')
      .option('--hours <n>', 'Window in hours (default 168)')
      .option('--limit <n>', 'Max rows per list (default 25)')
  ).action(runAction(async (options) => {
    const client = new ApiClient(operatorOptions(options));
    const params = {};
    if (options.hours) params.hours = Number(options.hours);
    if (options.limit) params.limit = Number(options.limit);

    const report = await client.adminSignups(params);

    if (options.format === 'json') {
      console.log(formatOutput(report, 'json'));
      return;
    }

    console.log(chalk.cyan.bold(`\nSignups in the last ${report.window_hours} hours (${report.signups.length}):\n`));
    const table = new Table({ head: ['User', 'Email', 'When', 'Verified', 'Monitors', 'Plan', 'Source', 'Country'].map(h => chalk.cyan(h)), colWidths: [7, 32, 22, 10, 10, 10, 16, 9] });
    report.signups.forEach(s => {
      table.push([s.user_id, s.email, s.signed_up_at, s.email_verified ? 'yes' : chalk.yellow('no'), s.monitors, s.plan, s.signup?.utm_source || '-', s.signup?.country || '-']);
    });
    console.log(table.toString());

    if (report.blocked_attempts.length > 0) {
      console.log(chalk.cyan.bold(`\nBlocked attempts (${report.blocked_attempts.length}):\n`));
      const blocked = new Table({ head: ['When', 'Email', 'Outcome', 'Country', 'Form'].map(h => chalk.cyan(h)), colWidths: [27, 32, 20, 9, 9] });
      report.blocked_attempts.forEach(b => blocked.push([b.at, b.email, b.outcome, b.country || '-', b.form_ms != null ? `${b.form_ms}ms` : '-']));
      console.log(blocked.toString());
    }
  }));

  return admin;
}

module.exports = createAdminCommands;
