const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const Table = require('cli-table3');
const { formatOutput, formatKeyValue, colorizeStatus } = require('../utils/formatter');
const { withCommonOptions, runAction, parseJsonFlag } = require('../utils/command');
const ApiClient = require('../api/client');

function formatStatusPagesTable(pages) {
  const table = new Table({
    head: ['ID', 'Name', 'Slug', 'Services', 'Custom Domain'].map(h => chalk.cyan(h)),
    colWidths: [6, 28, 22, 10, 40]
  });

  pages.forEach(page => {
    table.push([
      page.id,
      page.name?.substring(0, 26) || '-',
      page.slug?.substring(0, 20) || '-',
      (page.services || []).length,
      page.custom_domain
        ? `${page.custom_domain}${page.domain_verified ? '' : ' (unverified)'}`
        : '-'
    ]);
  });

  return table.toString();
}

function formatStatusPageDetails(page) {
  let output = formatKeyValue({
    'ID': page.id,
    'Name': page.name,
    'Slug': page.slug,
    'Description': page.description || '-',
    'Logo URL': page.logo_url || '-',
    'Custom Domain': page.custom_domain || '-',
    'Domain Verified': page.domain_verified ? 'Yes' : 'No',
    'Created': page.created_at,
    'Updated': page.updated_at
  });

  if (page.services && page.services.length > 0) {
    output += chalk.cyan.bold(`\n\nServices (${page.services.length}):\n`);
    page.services.forEach(service => {
      output += `\n  ${colorizeStatus(service.monitor_status)}  ${service.label}  ${chalk.gray(service.monitor_url || '')}  (monitor ${service.monitor_id})`;
    });
  }

  return output;
}

/**
 * Parse "12,34:API,56:Website" into the API's monitors array. A label after
 * the colon is optional; the monitor's own name is used when omitted.
 */
function parseMonitorsFlag(value) {
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [id, ...labelParts] = item.split(':');
      const entry = { id: parseInt(id, 10) };
      if (Number.isNaN(entry.id)) {
        throw new Error(`--monitors expects monitor IDs (got "${id}")`);
      }
      const label = labelParts.join(':').trim();
      if (label) entry.label = label;
      return entry;
    });
}

function createStatusPagesCommands() {
  const statusPages = new Command('status-pages')
    .description('Status page management commands');

  // List status pages
  withCommonOptions(
    statusPages.command('list')
      .alias('ls')
      .description('List all status pages')
      .option('--search <query>', 'Search by name or slug')
      .option('--sort <field>', 'Sort by field (title, slug, created_at, updated_at)', 'title')
      .option('--direction <dir>', 'Sort direction (asc, desc)', 'asc')
      .option('--per-page <number>', 'Results per page', '20')
  ).action(runAction(async (options) => {
    const client = new ApiClient(options);

    const params = {};
    if (options.search) params.search = options.search;
    if (options.sort) params.sort = options.sort;
    if (options.direction) params.direction = options.direction;
    if (options.perPage) params.per_page = options.perPage;

    const result = await client.listStatusPages(params);

    if (options.format === 'json') {
      console.log(formatOutput(result, 'json'));
      return;
    }

    if (result.data.length === 0) {
      console.log(chalk.yellow('No status pages found.'));
      return;
    }

    console.log(chalk.cyan.bold(`\nStatus Pages (${result.total} total):\n`));
    console.log(formatStatusPagesTable(result.data));
  }));

  // Get status page details
  withCommonOptions(statusPages.command('get <id>').description('Get details for a specific status page'))
    .action(runAction(async (id, options) => {
      const client = new ApiClient(options);
      const page = await client.getStatusPage(id);

      if (options.format === 'json') {
        console.log(formatOutput(page, 'json'));
        return;
      }

      console.log(chalk.cyan.bold('\nStatus Page Details:\n'));
      console.log(formatStatusPageDetails(page));
    }));

  // Create status page
  withCommonOptions(
    statusPages.command('create')
      .description('Create a new status page')
      .option('--monitors <list>', 'Monitors to show, as id[:label] pairs, e.g. 12:API,34:Website')
      .option('--monitor-id <id>', 'Single monitor to show (shorthand for --monitors <id>)')
      .option('--name <name>', 'Status page name')
      .option('--slug <slug>', 'URL slug for the status page')
      .option('--description <text>', 'Status page description')
      .option('--logo-url <url>', 'Logo URL')
      .option('--settings <json>', 'Display settings as JSON (show_uptime_percentage, show_response_time, show_incident_history, custom_css)'),
    { formatDefault: 'table' }
  ).action(runAction(async (options) => {
    const data = {};

    const monitorsFlag = options.monitors || options.monitorId;

    if (!monitorsFlag || !options.name || !options.slug) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'monitors',
          message: 'Enter monitor IDs to show (comma-separated):',
          when: !monitorsFlag,
          validate: (input) => /^\s*\d+(\s*,\s*\d+)*\s*$/.test(input) || 'Please enter one or more numeric monitor IDs'
        },
        {
          type: 'input',
          name: 'name',
          message: 'Enter status page name:',
          when: !options.name
        },
        {
          type: 'input',
          name: 'slug',
          message: 'Enter URL slug:',
          when: !options.slug,
          validate: (input) => /^[a-z0-9-_]+$/.test(input) || 'Slug must be lowercase alphanumeric with dashes'
        }
      ]);

      data.monitors = parseMonitorsFlag(monitorsFlag || answers.monitors);
      data.name = options.name || answers.name;
      data.slug = options.slug || answers.slug;
    } else {
      data.monitors = parseMonitorsFlag(monitorsFlag);
      data.name = options.name;
      data.slug = options.slug;
    }

    if (options.description) data.description = options.description;
    if (options.logoUrl) data.logo_url = options.logoUrl;
    if (options.settings) data.settings = parseJsonFlag(options.settings, '--settings');

    const client = new ApiClient(options);
    const page = await client.createStatusPage(data);

    if (options.format === 'json') {
      console.log(formatOutput(page, 'json'));
      return;
    }

    console.log(chalk.green('✓ Status page created successfully!\n'));
    console.log(formatStatusPageDetails(page));
  }));

  // Update status page
  withCommonOptions(
    statusPages.command('update <id>')
      .description('Update a status page')
      .option('--name <name>', 'Status page name')
      .option('--slug <slug>', 'URL slug')
      .option('--description <text>', 'Status page description')
      .option('--logo-url <url>', 'Logo URL')
      .option('--monitors <list>', 'Replace the services list, as id[:label] pairs')
      .option('--settings <json>', 'Display settings as JSON'),
    { formatDefault: 'table' }
  ).action(runAction(async (id, options) => {
    const data = {};
    if (options.name) data.name = options.name;
    if (options.slug) data.slug = options.slug;
    if (options.description !== undefined) data.description = options.description;
    if (options.logoUrl !== undefined) data.logo_url = options.logoUrl;
    if (options.monitors !== undefined) data.monitors = parseMonitorsFlag(options.monitors);
    if (options.settings !== undefined) data.settings = parseJsonFlag(options.settings, '--settings');

    if (Object.keys(data).length === 0) {
      throw new Error('At least one field must be provided to update.');
    }

    const client = new ApiClient(options);
    const page = await client.updateStatusPage(id, data);

    if (options.format === 'json') {
      console.log(formatOutput(page, 'json'));
      return;
    }

    console.log(chalk.green('✓ Status page updated successfully!\n'));
    console.log(formatStatusPageDetails(page));
  }));

  // Delete status page
  withCommonOptions(
    statusPages.command('delete <id>')
      .alias('rm')
      .description('Delete a status page')
      .option('--yes', 'Skip confirmation prompt'),
    { format: false }
  ).action(runAction(async (id, options) => {
    if (!options.yes) {
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Are you sure you want to delete status page ${id}?`,
          default: false
        }
      ]);

      if (!answers.confirm) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }

    const client = new ApiClient(options);
    await client.deleteStatusPage(id);

    console.log(chalk.green(`✓ Status page ${id} deleted successfully.`));
  }));

  return statusPages;
}

module.exports = createStatusPagesCommands;
