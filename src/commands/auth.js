const { Command } = require('commander');
const chalk = require('chalk');
const config = require('../utils/config');
const { getToken, getApiUrl } = require('../utils/auth');
const { formatKeyValue } = require('../utils/formatter');
const ApiClient = require('../api/client');

function createAuthCommands() {
  const auth = new Command('auth')
    .description('Authentication commands');

  // Login command
  auth
    .command('login')
    .description('Save authentication token to config file')
    .requiredOption('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'Override API URL (for local dev or self-hosted)')
    .action(async (options) => {
      try {
        // Save token to config
        config.set('token', options.token);
        
        // Save API URL if provided
        if (options.apiUrl) {
          config.set('apiUrl', options.apiUrl);
        }

        // Verify token by calling the test endpoint
        const client = new ApiClient(options);
        const result = await client.testAuth();

        console.log(chalk.green('✓ Successfully authenticated!'));
        console.log(chalk.cyan('\nUser Info:'));
        console.log(formatKeyValue({
          'Name': result.user.name,
          'Email': result.user.email,
          'ID': result.user.id
        }));
        console.log(chalk.gray(`\nConfig saved to: ${config.path}`));
      } catch (error) {
        console.error(chalk.red('✗ Authentication failed:'), error.message);
        
        // Remove saved token if verification failed
        config.delete('token');
        
        process.exit(1);
      }
    });

  // Logout command
  auth
    .command('logout')
    .description('Remove authentication token from config file')
    .action(() => {
      const hasToken = config.has('token');
      
      if (!hasToken) {
        console.log(chalk.yellow('No authentication token found in config.'));
        return;
      }

      config.delete('token');
      console.log(chalk.green('✓ Successfully logged out.'));
      console.log(chalk.gray('Token removed from config file.'));
    });

  // Status command - show config without network call
  auth
    .command('status')
    .description('Display current configuration (no network call)')
    .action(() => {
      const { token, source } = getToken({});
      const apiUrl = getApiUrl({});

      console.log(chalk.cyan('Current Configuration:\n'));
      console.log(formatKeyValue({
        'API URL': apiUrl,
        'Token': token ? `${token.substring(0, 8)}...` : chalk.yellow('Not set'),
        'Token Source': token ? source : '-',
        'Config Path': config.path
      }));

      if (!token) {
        console.log(chalk.gray('\nRun "sentinel auth login --token YOUR_TOKEN" to authenticate.'));
      }
    });

  // Whoami command
  auth
    .command('whoami')
    .description('Display current authentication status and verify with API')
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL')
    .action(async (options) => {
      try {
        const { token, source } = getToken(options);
        const apiUrl = getApiUrl(options);

        if (!token) {
          console.log(chalk.yellow('Not authenticated.'));
          console.log(chalk.gray('\nRun "sentinel auth login --token YOUR_TOKEN" to authenticate.'));
          return;
        }

        console.log(chalk.cyan('Authentication Status:\n'));
        console.log(formatKeyValue({
          'Token Source': source,
          'API URL': apiUrl,
          'Config Path': config.path
        }));

        // The v1 root answers with the user and the team every other
        // command will act on.
        const client = new ApiClient(options);
        const result = await client.getCurrentUser();
        const user = result.user || {};
        const team = result.team;

        console.log(chalk.cyan('\nCurrent User:\n'));
        console.log(formatKeyValue({
          'Name': user.name,
          'Email': user.email,
          'ID': user.id,
          'Timezone': user.timezone || '-'
        }));

        console.log(chalk.cyan('\nCurrent Team:\n'));
        console.log(team
          ? formatKeyValue({
            'Name': team.name,
            'ID': team.id,
            'Slug': team.slug || '-',
            'Personal': team.personal_team ? 'Yes' : 'No'
          })
          : chalk.yellow('No current team. Run "sentinel teams list" and "sentinel teams switch <id>".'));

      } catch (error) {
        console.error(chalk.red('\n✗ Error:'), error.message);
        process.exit(1);
      }
    });

  return auth;
}

module.exports = createAuthCommands;

