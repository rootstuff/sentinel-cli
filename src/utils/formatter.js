const Table = require('cli-table3');
const chalk = require('chalk');

/**
 * Format output based on format option
 */
function formatOutput(data, format = 'table') {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  return data;
}

/**
 * Colorize status text
 */
function colorizeStatus(status) {
  switch (status) {
    case 'up':
    case 'online':
    case 'active':
    case 'resolved':
      return chalk.green(status);
    case 'down':
    case 'offline':
    case 'failed':
    case 'error':
      return chalk.red(status);
    case 'pending':
    case 'degraded':
    case 'partial':
    case 'blocked':
    case 'unknown':
      return chalk.yellow(status);
    case 'open':
      return chalk.red(status);
    default:
      return status;
  }
}

/**
 * Human label for a check interval stored in minutes (0.5 = 30s).
 */
function formatInterval(minutes) {
  if (minutes === null || minutes === undefined) return '-';
  const value = Number(minutes);
  if (value < 1) return `${Math.round(value * 60)}s`;
  return `${value}m`;
}

function truncate(text, max) {
  const value = String(text ?? '');
  return value.length > max ? value.substring(0, max - 3) + '...' : value;
}

/**
 * Format monitors as a table
 */
function formatMonitorsTable(monitors) {
  const table = new Table({
    head: ['ID', 'Name', 'URL', 'Type', 'Status', 'Interval', 'Last Checked', 'Paused'].map(h => chalk.cyan(h)),
    colWidths: [8, 22, 40, 11, 10, 10, 22, 8]
  });

  monitors.forEach(monitor => {
    table.push([
      monitor.id,
      truncate(monitor.friendly_name || '-', 20),
      truncate(monitor.url || '-', 38),
      monitor.monitor_type || 'http',
      colorizeStatus(monitor.status),
      formatInterval(monitor.check_interval),
      monitor.last_checked_at || 'Never',
      monitor.is_paused ? chalk.yellow('Yes') : 'No'
    ]);
  });

  return table.toString();
}

/**
 * Format incidents as a table
 */
function formatIncidentsTable(incidents) {
  const table = new Table({
    head: ['ID', 'Monitor', 'Status', 'Started At', 'Duration'].map(h => chalk.cyan(h)),
    colWidths: [8, 40, 12, 25, 12]
  });

  incidents.forEach(incident => {
    const monitorUrl = incident.monitor?.url || 'N/A';
    table.push([
      incident.id,
      truncate(monitorUrl, 38),
      colorizeStatus(incident.status),
      incident.started_at,
      incident.duration ? `${incident.duration}m` : 'Ongoing'
    ]);
  });

  return table.toString();
}

/**
 * Format monitor details
 */
function formatMonitorDetails(monitor) {
  const details = [
    ['ID', monitor.id],
    ['Name', monitor.friendly_name || '-'],
    ['Type', monitor.monitor_type || 'http'],
    ['URL', monitor.url || '-'],
    ['Status', colorizeStatus(monitor.status)],
    ['Paused', monitor.is_paused ? chalk.yellow('Yes') : 'No']
  ];

  const isPush = ['heartbeat', 'cron'].includes(monitor.monitor_type);

  if (isPush) {
    if (monitor.heartbeat_interval) details.push(['Heartbeat Interval', `${monitor.heartbeat_interval} seconds`]);
    if (monitor.heartbeat_cron_expression) details.push(['Cron Expression', monitor.heartbeat_cron_expression]);
    if (monitor.heartbeat_timezone) details.push(['Timezone', monitor.heartbeat_timezone]);
    if (monitor.heartbeat_grace !== undefined && monitor.heartbeat_grace !== null) details.push(['Grace', `${monitor.heartbeat_grace} seconds`]);
    if (monitor.ping_url) details.push(['Ping URL', monitor.ping_url]);
  } else {
    details.push(['Check Interval', formatInterval(monitor.check_interval)]);
    if (monitor.monitored_regions && monitor.monitored_regions.length > 0) {
      details.push(['Regions', monitor.monitored_regions.join(', ')]);
    }
  }

  if (monitor.monitor_type === 'port' && monitor.port) {
    details.push(['Port', monitor.port]);
  }

  if (monitor.group_id) {
    details.push(['Group ID', monitor.group_id]);
  }

  if (monitor.http_method && monitor.http_method !== 'GET') {
    details.push(['HTTP Method', monitor.http_method]);
  }

  if (monitor.accepted_status_codes && monitor.accepted_status_codes.length > 0) {
    details.push(['Accepted Codes', monitor.accepted_status_codes.join(', ')]);
  }

  if (monitor.check_types && monitor.check_types.length > 0) {
    details.push(['Check Types', monitor.check_types.join(', ')]);
  }

  if (monitor.ssl_expiry_threshold) {
    details.push(['SSL Expiry Threshold', `${monitor.ssl_expiry_threshold} days`]);
  }

  if (monitor.payment_settings?.expected) {
    details.push(['Payment Expected', JSON.stringify(monitor.payment_settings.expected)]);
  }

  details.push(
    ['Last Checked', monitor.last_checked_at || 'Never'],
    ['Created At', monitor.created_at],
    ['Updated At', monitor.updated_at]
  );

  const table = new Table();
  details.forEach(([key, value]) => {
    table.push({ [chalk.cyan(key)]: value });
  });

  return table.toString();
}

/**
 * Format incident details
 */
function formatIncidentDetails(incident) {
  const details = [
    ['ID', incident.id],
    ['Monitor', incident.monitor?.url || 'N/A'],
    ['Status', colorizeStatus(incident.status)],
    ['Started At', incident.started_at],
    ['Ended At', incident.ended_at || 'Ongoing'],
    ['Duration', incident.duration ? `${incident.duration} minutes` : 'Ongoing'],
    ['Root Cause', incident.root_cause || 'Not specified'],
    ['Is Regional', incident.is_regional ? 'Yes' : 'No']
  ];

  const table = new Table();
  details.forEach(([key, value]) => {
    table.push({ [chalk.cyan(key)]: value });
  });

  return table.toString();
}

/**
 * Format check result
 */
function formatCheckResult(result) {
  const uptimeTable = new Table();

  if (result.uptime) {
    uptimeTable.push(
      { [chalk.cyan('Status')]: colorizeStatus(result.uptime.status) },
      { [chalk.cyan('Response Time')]: result.uptime.response_time ? `${result.uptime.response_time}ms` : 'N/A' },
      { [chalk.cyan('Status Code')]: result.uptime.status_code || 'N/A' }
    );
  }

  let output = chalk.bold('\nUptime Check:\n') + uptimeTable.toString();

  if (result.ssl) {
    const sslTable = new Table();
    sslTable.push(
      { [chalk.cyan('Valid')]: result.ssl.valid ? chalk.green('Yes') : chalk.red('No') },
      { [chalk.cyan('Expires At')]: result.ssl.expires_at || 'N/A' },
      { [chalk.cyan('Days Until Expiry')]: result.ssl.days_until_expiry || 'N/A' }
    );
    output += chalk.bold('\n\nSSL Check:\n') + sslTable.toString();
  }

  return output;
}

/**
 * Format an on-demand global check: one row per region, then the verdict.
 */
function formatGlobalCheck(result) {
  const ms = (value) => (value === null || value === undefined ? '-' : `${value}ms`);

  const table = new Table({
    head: ['Region', 'Location', 'Status', 'Code', 'Total', 'DNS', 'TCP', 'TLS', 'TTFB', 'Error'].map(h => chalk.cyan(h)),
    colWidths: [8, 18, 10, 6, 9, 8, 8, 8, 8, 24]
  });

  (result.results || []).forEach(region => {
    table.push([
      region.region,
      region.name || '-',
      colorizeStatus(region.status),
      region.status_code ?? '-',
      ms(region.response_time_ms),
      ms(region.dns_ms),
      ms(region.tcp_ms),
      ms(region.tls_ms),
      ms(region.ttfb_ms),
      region.error || '-'
    ]);
  });

  const verdictLabel = {
    up: chalk.green.bold('UP'),
    partial: chalk.yellow.bold('PARTIAL'),
    down: chalk.red.bold('DOWN'),
    unknown: chalk.yellow.bold('UNKNOWN')
  }[result.verdict] || String(result.verdict).toUpperCase();

  return [
    '',
    table.toString(),
    '',
    `${chalk.bold('Verdict:')} ${verdictLabel}  (${result.reachable_regions} of ${result.total_regions} regions reached ${result.url})`,
    chalk.gray(`Checked at ${result.checked_at}`)
  ].join('\n');
}

/**
 * Create a simple key-value table
 */
function formatKeyValue(data) {
  const table = new Table();
  Object.entries(data).forEach(([key, value]) => {
    table.push({ [chalk.cyan(key)]: value });
  });
  return table.toString();
}

module.exports = {
  formatOutput,
  colorizeStatus,
  formatInterval,
  formatMonitorsTable,
  formatIncidentsTable,
  formatMonitorDetails,
  formatIncidentDetails,
  formatCheckResult,
  formatGlobalCheck,
  formatKeyValue
};
