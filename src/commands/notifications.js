const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const config = require('../utils/config');
const { formatOutput, formatKeyValue } = require('../utils/formatter');
const ApiClient = require('../api/client');

function formatChannelsTable(channels) {
  const Table = require('cli-table3');
  const table = new Table({
    head: [
      chalk.cyan('ID'),
      chalk.cyan('Type'),
      chalk.cyan('Name'),
      chalk.cyan('Enabled'),
      chalk.cyan('Configured')
    ],
    colWidths: [10, 10, 15, 10, 12]
  });

  channels.forEach(channel => {
    const enabledColor = channel.enabled ? chalk.green : chalk.gray;
    const configuredColor = channel.configured ? chalk.green : chalk.yellow;
    
    table.push([
      channel.id,
      channel.type,
      channel.name,
      enabledColor(channel.enabled ? 'Yes' : 'No'),
      configuredColor(channel.configured ? 'Yes' : 'No')
    ]);
  });

  return table.toString();
}

function formatChannelDetails(channel) {
  const details = {
    'ID': channel.id,
    'Type': channel.type,
    'Name': channel.name,
    'Enabled': channel.enabled ? 'Yes' : 'No',
    'Configured': channel.configured ? 'Yes' : 'No',
  };

  if (channel.email) details['Email'] = channel.email;
  if (channel.phone_number) details['Phone'] = channel.phone_number;
  if (channel.webhook_url) details['Webhook'] = channel.webhook_url;
  if (channel.verified !== undefined) details['Verified'] = channel.verified ? 'Yes' : 'No';

  return formatKeyValue(details);
}

function createNotificationsCommands() {
  const notifications = new Command('notifications')
    .description('Notification channel management commands');

  // List notification channels
  notifications
    .command('list')
    .alias('ls')
    .description('List all notification channels')
    .option('--format <format>', 'Output format (table, json)', config.get('defaultFormat') || 'table')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (options) => {
      try {
        const client = new ApiClient(options);
        const result = await client.listNotificationChannels();

        if (options.format === 'json') {
          console.log(formatOutput(result, 'json'));
        } else {
          if (result.data.length === 0) {
            console.log(chalk.yellow('No notification channels configured.'));
            return;
          }

          console.log(chalk.cyan.bold('\nNotification Channels:\n'));
          console.log(formatChannelsTable(result.data));
        }
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // Get notification channel details
  notifications
    .command('get <channel>')
    .description('Get details for a notification channel (slack, sms, email)')
    .option('--format <format>', 'Output format (table, json)', config.get('defaultFormat') || 'table')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (channel, options) => {
      try {
        const client = new ApiClient(options);
        const result = await client.getNotificationChannel(channel);

        if (options.format === 'json') {
          console.log(formatOutput(result, 'json'));
        } else {
          console.log(chalk.cyan.bold('\nChannel Details:\n'));
          console.log(formatChannelDetails(result));
        }
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // Create/configure notification channel
  notifications
    .command('create')
    .description('Configure a notification channel')
    .option('--type <type>', 'Channel type (slack, sms)')
    .option('--webhook-url <url>', 'Slack webhook URL')
    .option('--phone <number>', 'Phone number for SMS')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (options) => {
      try {
        let data = {};

        // Prompt for type if not provided
        if (!options.type) {
          const typeAnswer = await inquirer.prompt([
            {
              type: 'list',
              name: 'type',
              message: 'Select channel type:',
              choices: ['slack', 'sms']
            }
          ]);
          options.type = typeAnswer.type;
        }

        data.type = options.type;

        if (options.type === 'slack') {
          if (!options.webhookUrl) {
            const answer = await inquirer.prompt([
              {
                type: 'input',
                name: 'webhookUrl',
                message: 'Enter Slack webhook URL:',
                validate: (input) => input.startsWith('https://hooks.slack.com/') || 'Please enter a valid Slack webhook URL'
              }
            ]);
            data.webhook_url = answer.webhookUrl;
          } else {
            data.webhook_url = options.webhookUrl;
          }
        } else if (options.type === 'sms') {
          if (!options.phone) {
            const answer = await inquirer.prompt([
              {
                type: 'input',
                name: 'phone',
                message: 'Enter phone number (with country code):',
              }
            ]);
            data.phone_number = answer.phone;
          } else {
            data.phone_number = options.phone;
          }
        }

        const client = new ApiClient(options);
        const result = await client.createNotificationChannel(data);

        console.log(chalk.green(`✓ ${result.type} channel configured successfully!\n`));
        
        if (options.format === 'json') {
          console.log(formatOutput(result, 'json'));
        } else {
          console.log(formatChannelDetails(result));
        }
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // Update notification channel
  notifications
    .command('update <channel>')
    .description('Update a notification channel')
    .option('--enabled <bool>', 'Enable or disable the channel')
    .option('--webhook-url <url>', 'Slack webhook URL')
    .option('--phone <number>', 'Phone number for SMS')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (channel, options) => {
      try {
        const data = {};

        if (options.enabled !== undefined) {
          data.enabled = options.enabled === 'true';
        }
        if (options.webhookUrl) data.webhook_url = options.webhookUrl;
        if (options.phone) data.phone_number = options.phone;

        if (Object.keys(data).length === 0) {
          console.error(chalk.red('✗ Error: At least one field must be provided to update.'));
          process.exit(1);
        }

        const client = new ApiClient(options);
        const result = await client.updateNotificationChannel(channel, data);

        console.log(chalk.green(`✓ ${channel} channel updated successfully!\n`));
        
        if (options.format === 'json') {
          console.log(formatOutput(result, 'json'));
        } else {
          console.log(formatChannelDetails(result));
        }
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // Enable channel
  notifications
    .command('enable <channel>')
    .description('Enable a notification channel')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (channel, options) => {
      try {
        const client = new ApiClient(options);
        await client.updateNotificationChannel(channel, { enabled: true });

        console.log(chalk.green(`✓ ${channel} notifications enabled.`));
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // Disable channel
  notifications
    .command('disable <channel>')
    .description('Disable a notification channel')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (channel, options) => {
      try {
        const client = new ApiClient(options);
        await client.updateNotificationChannel(channel, { enabled: false });

        console.log(chalk.green(`✓ ${channel} notifications disabled.`));
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // Delete notification channel
  notifications
    .command('delete <channel>')
    .alias('rm')
    .description('Remove a notification channel')
    .option('--yes', 'Skip confirmation prompt')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (channel, options) => {
      try {
        if (!options.yes) {
          const answers = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Are you sure you want to remove the ${channel} channel?`,
              default: false
            }
          ]);

          if (!answers.confirm) {
            console.log(chalk.yellow('Cancelled.'));
            return;
          }
        }

        const client = new ApiClient(options);
        await client.deleteNotificationChannel(channel);

        console.log(chalk.green(`✓ ${channel} channel removed successfully.`));
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // Test notification channel
  notifications
    .command('test <channel>')
    .description('Send a test notification to a channel')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (channel, options) => {
      try {
        const client = new ApiClient(options);
        
        console.log(chalk.cyan(`Sending test notification to ${channel}...`));
        const result = await client.testNotificationChannel(channel);

        if (result.success) {
          console.log(chalk.green(`✓ ${result.message}`));
        } else {
          console.log(chalk.red(`✗ ${result.message}`));
        }
      } catch (error) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  return notifications;
}

module.exports = createNotificationsCommands;
