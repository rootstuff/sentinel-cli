const { Command } = require('commander');
const chalk = require('chalk');
const config = require('../utils/config');
const {
  formatIncidentsTable,
  formatIncidentDetails,
  formatOutput
} = require('../utils/formatter');
const ApiClient = require('../api/client');

function createIncidentsCommands() {
  const incidents = new Command('incidents')
    .description('Incident management commands');

  // List incidents
  incidents
    .command('list')
    .alias('ls')
    .description('List all incidents')
    .option('--monitor-id <id>', 'Filter by monitor ID')
    .option('--status <status>', 'Filter by status (open, resolved)')
    .option('--start-date <date>', 'Filter by start date (YYYY-MM-DD)')
    .option('--end-date <date>', 'Filter by end date (YYYY-MM-DD)')
    .option('--sort <field>', 'Sort by field (started_at, ended_at, duration, status)', 'started_at')
    .option('--direction <dir>', 'Sort direction (asc, desc)', 'desc')
    .option('--per-page <number>', 'Results per page', '20')
    .option('--format <format>', 'Output format (table, json)', config.get('defaultFormat') || 'table')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (options) => {
      try {
        const client = new ApiClient(options);
        
        const params = {};
        if (options.monitorId) params.monitor_id = options.monitorId;
        if (options.status) params.status = options.status;
        if (options.startDate) params.start_date = options.startDate;
        if (options.endDate) params.end_date = options.endDate;
        if (options.sort) params.sort = options.sort;
        if (options.direction) params.direction = options.direction;
        if (options.perPage) params.per_page = options.perPage;

        const result = await client.listIncidents(params);

        if (options.format === 'json') {
          console.log(formatOutput(result, 'json'));
        } else {
          if (result.data.length === 0) {
            console.log(chalk.yellow('No incidents found.'));
            return;
          }

          console.log(chalk.cyan.bold(`\nIncidents (${result.total} total, showing page ${result.current_page} of ${result.last_page}):\n`));
          console.log(formatIncidentsTable(result.data));
          
          if (result.current_page < result.last_page) {
            console.log(chalk.gray(`\nShowing ${result.from}-${result.to} of ${result.total} incidents`));
          }
        }
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // Get incident details
  incidents
    .command('get <id>')
    .description('Get details for a specific incident')
    .option('--format <format>', 'Output format (table, json)', config.get('defaultFormat') || 'table')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (id, options) => {
      try {
        const client = new ApiClient(options);
        const incident = await client.getIncident(id);

        if (options.format === 'json') {
          console.log(formatOutput(incident, 'json'));
        } else {
          console.log(chalk.cyan.bold('\nIncident Details:\n'));
          console.log(formatIncidentDetails(incident));

          if (incident.activities && incident.activities.length > 0) {
            console.log(chalk.cyan.bold(`\n\nActivities (${incident.activities.length}):\n`));
            incident.activities.forEach(activity => {
              console.log(`  ${activity.created_at} - ${activity.description}`);
            });
          }
        }
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // Resolve incident
  incidents
    .command('resolve <id>')
    .description('Mark an incident as resolved')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (id, options) => {
      try {
        const client = new ApiClient(options);
        const incident = await client.resolveIncident(id);

        console.log(chalk.green('✓ Incident resolved successfully!\n'));
        
        if (options.format === 'json') {
          console.log(formatOutput(incident, 'json'));
        } else {
          console.log(formatIncidentDetails(incident));
        }
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // Acknowledge incident
  incidents
    .command('acknowledge <id>')
    .alias('ack')
    .description('Acknowledge an incident')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (id, options) => {
      try {
        const client = new ApiClient(options);
        const result = await client.acknowledgeIncident(id);

        console.log(chalk.green('✓ Incident acknowledged successfully!\n'));
        
        if (options.format === 'json') {
          console.log(formatOutput(result, 'json'));
        } else {
          console.log(formatIncidentDetails(result.incident));
        }
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // Delete incident
  incidents
    .command('delete <id>')
    .alias('rm')
    .description('Delete an incident')
    .option('--yes', 'Skip confirmation prompt')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (id, options) => {
      try {
        const inquirer = require('inquirer');
        
        if (!options.yes) {
          const answers = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Are you sure you want to delete incident ${id}?`,
              default: false
            }
          ]);

          if (!answers.confirm) {
            console.log(chalk.yellow('Cancelled.'));
            return;
          }
        }

        const client = new ApiClient(options);
        await client.deleteIncident(id);

        console.log(chalk.green(`✓ Incident ${id} deleted successfully.`));
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  return incidents;
}

module.exports = createIncidentsCommands;

