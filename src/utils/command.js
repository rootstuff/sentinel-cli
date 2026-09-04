const chalk = require('chalk');
const config = require('./config');

/**
 * Attach the options every command accepts: --token, --api-url, and
 * optionally --format. Returns the command for chaining.
 */
function withCommonOptions(command, { format = true, formatDefault } = {}) {
  if (format) {
    command.option(
      '--format <format>',
      'Output format (table, json)',
      formatDefault || config.get('defaultFormat') || 'table'
    );
  }

  return command
    .option('--token <token>', 'API authentication token')
    .option('--api-url <url>', 'API base URL');
}

/**
 * Wrap a command action so any thrown error prints consistently and exits 1.
 */
function runAction(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      console.error(chalk.red('✗ Error:'), error.message);
      process.exit(1);
    }
  };
}

/**
 * Parse a JSON-valued flag, naming the flag in the error so a typo in a
 * settings object is easy to spot.
 */
function parseJsonFlag(value, flagName) {
  if (value === undefined) return undefined;

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${flagName} must be valid JSON (${error.message})`);
  }
}

/**
 * Split a comma-separated flag into a trimmed, non-empty list.
 */
function parseListFlag(value) {
  if (value === undefined) return undefined;

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Parse a "true"/"false"/"yes"/"no"/"1"/"0" flag value into a boolean.
 */
function parseBooleanFlag(value, flagName) {
  if (value === undefined) return undefined;

  const normalized = String(value).toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(normalized)) return true;
  if (['false', 'no', '0', 'off'].includes(normalized)) return false;

  throw new Error(`${flagName} must be true or false`);
}

module.exports = {
  withCommonOptions,
  runAction,
  parseJsonFlag,
  parseListFlag,
  parseBooleanFlag
};
