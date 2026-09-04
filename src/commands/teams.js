const { Command } = require('commander');
const chalk = require('chalk');
const Table = require('cli-table3');
const { formatOutput, formatKeyValue } = require('../utils/formatter');
const { withCommonOptions, runAction } = require('../utils/command');
const ApiClient = require('../api/client');

function formatTeamsTable(teams) {
  const table = new Table({
    head: ['ID', 'Name', 'Slug', 'Role', 'Personal', 'Current'].map(h => chalk.cyan(h)),
    colWidths: [8, 30, 25, 10, 10, 10]
  });

  teams.forEach(team => {
    table.push([
      team.id,
      team.name,
      team.slug || '-',
      team.role,
      team.personal_team ? 'Yes' : 'No',
      team.is_current ? chalk.green('Yes') : 'No'
    ]);
  });

  return table.toString();
}

function createTeamsCommands() {
  const teams = new Command('teams')
    .description('Team commands (list teams, switch the active team)');

  withCommonOptions(teams.command('list').alias('ls').description('List the teams you own or belong to'))
    .action(runAction(async (options) => {
      const client = new ApiClient(options);
      const result = await client.listTeams();

      if (options.format === 'json') {
        console.log(formatOutput(result, 'json'));
        return;
      }

      if (result.data.length === 0) {
        console.log(chalk.yellow('No teams found.'));
        return;
      }

      console.log(chalk.cyan.bold('\nTeams:\n'));
      console.log(formatTeamsTable(result.data));
      console.log(chalk.gray('\nEvery other command runs against the current team. Use "sentinel teams switch <id>" to change it.'));
    }));

  withCommonOptions(teams.command('switch <id>').description('Make a team the active one for this token'))
    .action(runAction(async (id, options) => {
      const client = new ApiClient(options);
      const team = await client.switchTeam(id);

      if (options.format === 'json') {
        console.log(formatOutput(team, 'json'));
        return;
      }

      console.log(chalk.green(`✓ Switched to team "${team.name}".\n`));
      console.log(formatKeyValue({
        'ID': team.id,
        'Name': team.name,
        'Slug': team.slug || '-',
        'Personal': team.personal_team ? 'Yes' : 'No'
      }));
    }));

  return teams;
}

module.exports = createTeamsCommands;
