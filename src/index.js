const { Command } = require('commander');
const createAuthCommands = require('./commands/auth');
const createCheckCommand = require('./commands/check');
const createMonitorsCommands = require('./commands/monitors');
const createGroupsCommands = require('./commands/groups');
const createIncidentsCommands = require('./commands/incidents');
const createUsersCommands = require('./commands/users');
const createTeamsCommands = require('./commands/teams');
const createWebhooksCommands = require('./commands/webhooks');
const createStatusPagesCommands = require('./commands/status-pages');
const createNotificationsCommands = require('./commands/notifications');
const createAdminCommands = require('./commands/admin');

const packageJson = require('../package.json');

function createCli() {
  const program = new Command();

  program
    .name('sentinel')
    .description('CLI for the Sentinel uptime monitoring API (https://sentinel.rootstuff.io)')
    .version(packageJson.version);

  // Add command groups
  program.addCommand(createAuthCommands());
  program.addCommand(createCheckCommand());
  program.addCommand(createMonitorsCommands());
  program.addCommand(createGroupsCommands());
  program.addCommand(createIncidentsCommands());
  program.addCommand(createUsersCommands());
  program.addCommand(createTeamsCommands());
  program.addCommand(createWebhooksCommands());
  program.addCommand(createStatusPagesCommands());
  program.addCommand(createNotificationsCommands());
  program.addCommand(createAdminCommands());

  // Show help if no command provided
  if (process.argv.length <= 2) {
    program.help();
  }

  return program;
}

module.exports = createCli;
