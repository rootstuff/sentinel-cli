const { Command } = require('commander');
const chalk = require('chalk');
const { formatOutput, formatKeyValue } = require('../utils/formatter');
const { withCommonOptions, runAction } = require('../utils/command');
const ApiClient = require('../api/client');

// Billing belongs to the token's own account (the plan owner), not to a
// team: recipients get every paid invoice as a PDF, information is what
// prints on the invoice.

function formatBilling(data) {
  const info = data.billing_information || {};
  const address = info.address || {};
  const addressLine = [address.line1, address.line2, address.city, address.state, address.postal_code, address.country]
    .filter(Boolean)
    .join(', ');
  const taxLabel = info.tax_id_type ? (data.tax_id_types || {})[info.tax_id_type] || info.tax_id_type : null;

  return formatKeyValue({
    Plan: data.plan,
    Recipients: (data.billing_recipients || []).length ? data.billing_recipients.join(', ') : '-',
    Company: info.company || '-',
    Address: addressLine || '-',
    'Tax ID': info.tax_id ? `${info.tax_id} (${taxLabel})` : '-'
  });
}

function printBilling(data, options) {
  if (options.format === 'json') {
    console.log(formatOutput(data, 'json'));
    return;
  }
  console.log(chalk.cyan.bold('\nBilling:\n'));
  console.log(formatBilling(data));
}

function createBillingCommands() {
  const billing = new Command('billing')
    .description('Billing recipients and the company details printed on invoices (your own account)');

  withCommonOptions(billing.command('get').description('Show billing recipients and billing information'))
    .action(runAction(async (options) => {
      const client = new ApiClient(options);
      const result = await client.getBilling();
      printBilling(result.data, options);
    }));

  withCommonOptions(
    billing.command('recipients')
      .description('Set the addresses that receive every paid invoice as a PDF (replaces the list)')
      .argument('[emails...]', 'up to five email addresses; none to clear')
      .option('--clear', 'remove every billing recipient')
  )
    .action(runAction(async (emails, options) => {
      const client = new ApiClient(options);
      if (!options.clear && emails.length === 0) {
        throw new Error('Give one to five email addresses, or --clear to remove them all.');
      }
      const result = await client.updateBilling({ billing_recipients: options.clear ? [] : emails });
      printBilling(result.data, options);
      if (options.format !== 'json') {
        console.log(chalk.green(options.clear ? '\nBilling recipients cleared.' : '\nBilling recipients saved.'));
      }
    }));

  withCommonOptions(
    billing.command('information')
      .alias('info')
      .description('Set the company, address and tax ID printed on invoices (fields you omit are cleared)')
      .option('--company <name>', 'company or legal name; omit to invoice the account holder by name')
      .option('--line1 <text>', 'address line 1')
      .option('--line2 <text>', 'address line 2')
      .option('--city <text>', 'city')
      .option('--state <text>', 'state or region')
      .option('--postal-code <text>', 'postal code')
      .option('--country <code>', 'two-letter country code, e.g. US')
      .option('--tax-id-type <type>', 'tax ID type, e.g. us_ein or eu_vat (see `billing get --format json` for the list)')
      .option('--tax-id <value>', 'tax or VAT number')
  )
    .action(runAction(async (options) => {
      const client = new ApiClient(options);
      const result = await client.updateBilling({
        billing_information: {
          company: options.company ?? '',
          address: {
            line1: options.line1 ?? '',
            line2: options.line2 ?? '',
            city: options.city ?? '',
            state: options.state ?? '',
            postal_code: options.postalCode ?? '',
            country: options.country ?? ''
          },
          tax_id_type: options.taxIdType ?? '',
          tax_id: options.taxId ?? ''
        }
      });
      printBilling(result.data, options);
      if (options.format !== 'json') {
        if (result.warning) {
          console.log(chalk.yellow(`\n${result.warning}`));
        } else {
          console.log(chalk.green('\nBilling information saved. It appears on invoices from the next one on.'));
        }
      }
    }));

  return billing;
}

module.exports = createBillingCommands;
