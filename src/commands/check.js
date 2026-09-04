const { Command } = require('commander');
const chalk = require('chalk');
const { formatOutput, formatGlobalCheck } = require('../utils/formatter');
const { withCommonOptions, parseListFlag } = require('../utils/command');
const ApiClient = require('../api/client');

/**
 * Exit codes: 0 when every region reached the URL, 1 otherwise (partial,
 * down, or unknown), so the command doubles as a CI gate. --allow-partial
 * relaxes that to "at least one region reached it".
 */
function exitCodeFor(result, allowPartial) {
  if (result.verdict === 'up') return 0;
  if (allowPartial && result.verdict === 'partial') return 0;
  return 1;
}

function createCheckCommand() {
  const check = new Command('check')
    .description('Probe a URL from every monitoring region right now (no monitor created)')
    .argument('<url>', 'URL to check')
    .option('--regions <codes>', 'Comma-separated region codes to probe (ash, pdx, nbg, sin); default all')
    .option('--timeout <seconds>', 'Per-region timeout in seconds (1-30)', '15')
    .option('--allow-partial', 'Exit 0 when at least one region reaches the URL');

  withCommonOptions(check);

  check.action(async (url, options) => {
    const params = { url };
    const regions = parseListFlag(options.regions);
    if (regions && regions.length > 0) params.regions = regions;
    if (options.timeout) params.timeout_seconds = parseInt(options.timeout, 10);

    let result;

    try {
      const client = new ApiClient(options);

      if (options.format !== 'json') {
        console.log(chalk.cyan(`Checking ${url} from ${regions ? regions.join(', ') : 'all regions'}...`));
      }

      result = await client.checkUrl(params);
    } catch (error) {
      if (error.status === 403) {
        console.error(chalk.red('✗ On-demand checks are not available on this plan.'));
        console.error(chalk.gray(`  ${error.data?.error || error.data?.message || error.message}`));
        console.error(chalk.gray('  Any paid Sentinel plan includes global checks: https://sentinel.rootstuff.io/pricing'));
      } else if (error.status === 429) {
        console.error(chalk.red('✗ Rate limit reached.'), error.data?.error || error.message);
      } else {
        console.error(chalk.red('✗ Error:'), error.message);
      }
      process.exit(1);
    }

    if (options.format === 'json') {
      console.log(formatOutput(result, 'json'));
    } else {
      console.log(formatGlobalCheck(result));
    }

    const code = exitCodeFor(result, options.allowPartial);
    if (code !== 0) {
      process.exit(code);
    }
  });

  return check;
}

module.exports = createCheckCommand;
