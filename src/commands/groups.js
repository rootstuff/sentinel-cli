const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const Table = require('cli-table3');
const { formatOutput, formatKeyValue } = require('../utils/formatter');
const { withCommonOptions, runAction } = require('../utils/command');
const ApiClient = require('../api/client');

function formatGroupsTable(groups) {
  const table = new Table({
    head: ['ID', 'Name', 'Parent', 'Monitors', 'Description'].map(h => chalk.cyan(h)),
    colWidths: [8, 30, 10, 10, 40]
  });

  groups.forEach(group => {
    table.push([
      group.id,
      group.name,
      group.parent_id ?? '-',
      group.monitors_count ?? 0,
      group.description || '-'
    ]);
  });

  return table.toString();
}

function formatGroupDetails(group) {
  return formatKeyValue({
    'ID': group.id,
    'Name': group.name,
    'Description': group.description || '-',
    'Parent ID': group.parent_id ?? '-',
    'Sort Order': group.sort_order,
    'Monitors': group.monitors_count ?? 0,
    'Created': group.created_at,
    'Updated': group.updated_at
  });
}

function createGroupsCommands() {
  const groups = new Command('groups')
    .description('Monitor group commands (monitors join a group via --group-id)');

  withCommonOptions(groups.command('list').alias('ls').description('List all monitor groups'))
    .action(runAction(async (options) => {
      const client = new ApiClient(options);
      const result = await client.listGroups();

      if (options.format === 'json') {
        console.log(formatOutput(result, 'json'));
        return;
      }

      if (result.data.length === 0) {
        console.log(chalk.yellow('No groups found.'));
        return;
      }

      console.log(chalk.cyan.bold(`\nGroups (${result.total} total):\n`));
      console.log(formatGroupsTable(result.data));
    }));

  withCommonOptions(groups.command('get <id>').description('Get details for a group'))
    .action(runAction(async (id, options) => {
      const client = new ApiClient(options);
      const group = await client.getGroup(id);

      if (options.format === 'json') {
        console.log(formatOutput(group, 'json'));
        return;
      }

      console.log(chalk.cyan.bold('\nGroup Details:\n'));
      console.log(formatGroupDetails(group));
    }));

  withCommonOptions(
    groups.command('create')
      .description('Create a monitor group')
      .option('--name <name>', 'Group name (unique within the team, max 60 chars)')
      .option('--description <text>', 'Description (max 255 chars)')
      .option('--parent-id <id>', 'Parent group ID (groups nest one level deep)'),
    { formatDefault: 'table' }
  ).action(runAction(async (options) => {
    const data = {};

    if (!options.name) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Enter group name:',
          validate: (input) => input.trim().length > 0 || 'Name is required'
        }
      ]);
      data.name = answers.name;
    } else {
      data.name = options.name;
    }

    if (options.description !== undefined) data.description = options.description;
    if (options.parentId !== undefined) data.parent_id = parseInt(options.parentId, 10);

    const client = new ApiClient(options);
    const group = await client.createGroup(data);

    if (options.format === 'json') {
      console.log(formatOutput(group, 'json'));
      return;
    }

    console.log(chalk.green('✓ Group created successfully!\n'));
    console.log(formatGroupDetails(group));
  }));

  withCommonOptions(
    groups.command('update <id>')
      .description('Update a monitor group')
      .option('--name <name>', 'Group name')
      .option('--description <text>', 'Description')
      .option('--parent-id <id>', 'Parent group ID, or "none" to make it top-level'),
    { formatDefault: 'table' }
  ).action(runAction(async (id, options) => {
    if (options.name === undefined && options.description === undefined && options.parentId === undefined) {
      throw new Error('At least one field must be provided to update.');
    }

    const client = new ApiClient(options);

    // The API expects the whole group on update, so start from the stored one.
    const current = await client.getGroup(id);
    const data = {
      name: options.name ?? current.name,
      description: options.description ?? current.description,
      parent_id: current.parent_id
    };

    if (options.parentId !== undefined) {
      data.parent_id = options.parentId === 'none' ? null : parseInt(options.parentId, 10);
    }

    const group = await client.updateGroup(id, data);

    if (options.format === 'json') {
      console.log(formatOutput(group, 'json'));
      return;
    }

    console.log(chalk.green('✓ Group updated successfully!\n'));
    console.log(formatGroupDetails(group));
  }));

  withCommonOptions(
    groups.command('delete <id>')
      .alias('rm')
      .description('Delete a group (its monitors are ungrouped, subgroups move to the top level)')
      .option('--yes', 'Skip confirmation prompt'),
    { format: false }
  ).action(runAction(async (id, options) => {
    if (!options.yes) {
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Are you sure you want to delete group ${id}?`,
          default: false
        }
      ]);

      if (!answers.confirm) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }

    const client = new ApiClient(options);
    await client.deleteGroup(id);

    console.log(chalk.green(`✓ Group ${id} deleted successfully.`));
  }));

  return groups;
}

module.exports = createGroupsCommands;
