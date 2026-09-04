const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const Table = require('cli-table3');
const { formatOutput, formatKeyValue } = require('../utils/formatter');
const { withCommonOptions, runAction } = require('../utils/command');
const ApiClient = require('../api/client');

const ROLES = 'admin, editor, viewer';

function formatMembersTable(members) {
  const table = new Table({
    head: ['ID', 'Name', 'Email', 'Role', 'Status', 'MFA', 'Last Login'].map(h => chalk.cyan(h)),
    colWidths: [8, 22, 30, 9, 10, 6, 22]
  });

  members.forEach(member => {
    table.push([
      member.id,
      member.name,
      member.email,
      member.role,
      member.status === 'active' ? chalk.green(member.status) : chalk.yellow(member.status),
      member.mfa_enabled ? chalk.green('Yes') : chalk.yellow('No'),
      member.last_login_at || 'Never'
    ]);
  });

  return table.toString();
}

function formatMemberDetails(member) {
  return formatKeyValue({
    'ID': member.id,
    'Name': member.name,
    'Email': member.email,
    'Role': member.role,
    'Status': member.status,
    'MFA Enabled': member.mfa_enabled ? 'Yes' : 'No',
    'Added': member.added_at || '-',
    'Last Login': member.last_login_at || 'Never'
  });
}

function formatInvitationsTable(invitations) {
  const table = new Table({
    head: ['ID', 'Email', 'Role', 'Sent', 'Expires'].map(h => chalk.cyan(h)),
    colWidths: [8, 32, 9, 24, 24]
  });

  invitations.forEach(invitation => {
    table.push([
      invitation.id,
      invitation.email,
      invitation.role,
      invitation.created_at || '-',
      invitation.expires_at || '-'
    ]);
  });

  return table.toString();
}

function formatInvitationDetails(invitation) {
  return formatKeyValue({
    'ID': invitation.id,
    'Email': invitation.email,
    'Role': invitation.role,
    'Sent': invitation.created_at || '-',
    'Expires': invitation.expires_at || '-'
  });
}

async function confirmOrCancel(message, skip) {
  if (skip) return true;

  const answers = await inquirer.prompt([
    { type: 'confirm', name: 'confirm', message, default: false }
  ]);

  if (!answers.confirm) {
    console.log(chalk.yellow('Cancelled.'));
  }

  return answers.confirm;
}

function createInvitationsCommands() {
  const invitations = new Command('invitations')
    .description('Pending invitation commands');

  withCommonOptions(invitations.command('list').alias('ls').description('List pending invitations'))
    .action(runAction(async (options) => {
      const client = new ApiClient(options);
      const result = await client.listInvitations();

      if (options.format === 'json') {
        console.log(formatOutput(result, 'json'));
        return;
      }

      if (result.data.length === 0) {
        console.log(chalk.yellow('No pending invitations.'));
        return;
      }

      console.log(chalk.cyan.bold(`\nPending Invitations (${result.total}):\n`));
      console.log(formatInvitationsTable(result.data));
    }));

  withCommonOptions(
    invitations.command('set-role <id> <role>').description(`Change the role a pending invitation grants (${ROLES})`),
    { formatDefault: 'table' }
  ).action(runAction(async (id, role, options) => {
    const client = new ApiClient(options);
    const invitation = await client.updateInvitationRole(id, role);

    if (options.format === 'json') {
      console.log(formatOutput(invitation, 'json'));
      return;
    }

    console.log(chalk.green(`✓ Invitation ${id} now grants the ${invitation.role} role.\n`));
    console.log(formatInvitationDetails(invitation));
  }));

  withCommonOptions(
    invitations.command('cancel <id>').description('Cancel a pending invitation').option('--yes', 'Skip confirmation prompt'),
    { format: false }
  ).action(runAction(async (id, options) => {
    if (!(await confirmOrCancel(`Cancel invitation ${id}?`, options.yes))) return;

    const client = new ApiClient(options);
    await client.cancelInvitation(id);

    console.log(chalk.green(`✓ Invitation ${id} cancelled.`));
  }));

  return invitations;
}

function createUsersCommands() {
  const users = new Command('users')
    .description('Team member commands (list, invite, change roles, remove)');

  withCommonOptions(users.command('list').alias('ls').description('List team members with role, MFA state, and last sign-in'))
    .action(runAction(async (options) => {
      const client = new ApiClient(options);
      const result = await client.listUsers();

      if (options.format === 'json') {
        console.log(formatOutput(result, 'json'));
        return;
      }

      console.log(chalk.cyan.bold(`\nTeam "${result.team}" (${result.total} members):\n`));
      console.log(formatMembersTable(result.data));
    }));

  withCommonOptions(
    users.command('invite <email>')
      .description('Invite someone to the current team')
      .option('--role <role>', `Role to grant (${ROLES})`, 'viewer'),
    { formatDefault: 'table' }
  ).action(runAction(async (email, options) => {
    const client = new ApiClient(options);
    const invitation = await client.inviteUser({ email, role: options.role });

    if (options.format === 'json') {
      console.log(formatOutput(invitation, 'json'));
      return;
    }

    console.log(chalk.green(`✓ Invitation sent to ${invitation.email} as ${invitation.role}.\n`));
    console.log(formatInvitationDetails(invitation));
  }));

  withCommonOptions(
    users.command('set-role <member-id> <role>').description(`Change a member's role (${ROLES})`),
    { formatDefault: 'table' }
  ).action(runAction(async (memberId, role, options) => {
    const client = new ApiClient(options);
    const member = await client.updateUserRole(memberId, role);

    if (options.format === 'json') {
      console.log(formatOutput(member, 'json'));
      return;
    }

    console.log(chalk.green(`✓ ${member.name} is now ${member.role}.\n`));
    console.log(formatMemberDetails(member));
  }));

  withCommonOptions(
    users.command('remove <member-id>').alias('rm').description('Remove a member from the team').option('--yes', 'Skip confirmation prompt'),
    { format: false }
  ).action(runAction(async (memberId, options) => {
    if (!(await confirmOrCancel(`Remove member ${memberId} from the team?`, options.yes))) return;

    const client = new ApiClient(options);
    await client.removeUser(memberId);

    console.log(chalk.green(`✓ Member ${memberId} removed from the team.`));
  }));

  users.addCommand(createInvitationsCommands());

  return users;
}

module.exports = createUsersCommands;
