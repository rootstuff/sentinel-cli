const config = require('./config');

/**
 * Get authentication token with priority:
 * 1. Command-line flag (--token)
 * 2. Environment variable (SENTINEL_TOKEN)
 * 3. Config file
 */
function getToken(options = {}) {
  // Priority 1: Command-line flag
  if (options.token) {
    return { token: options.token, source: 'flag' };
  }

  // Priority 2: Environment variable
  if (process.env.SENTINEL_TOKEN) {
    return { token: process.env.SENTINEL_TOKEN, source: 'environment' };
  }

  // Priority 3: Config file
  const configToken = config.get('token');
  if (configToken) {
    return { token: configToken, source: 'config' };
  }

  return { token: null, source: null };
}

/**
 * Get API URL with priority:
 * 1. Command-line flag (--api-url)
 * 2. Environment variable (SENTINEL_API_URL)
 * 3. Config file
 */
function getApiUrl(options = {}) {
  if (options.apiUrl) {
    return options.apiUrl;
  }

  if (process.env.SENTINEL_API_URL) {
    return process.env.SENTINEL_API_URL;
  }

  return config.get('apiUrl');
}

/**
 * Require authentication and throw error if not found
 */
function requireAuth(options = {}) {
  const { token, source } = getToken(options);
  
  if (!token) {
    throw new Error(
      'Authentication required. Please provide a token using one of these methods:\n' +
      '  1. Command flag: --token YOUR_TOKEN\n' +
      '  2. Environment variable: SENTINEL_TOKEN=YOUR_TOKEN\n' +
      '  3. Login command: sentinel auth login --token YOUR_TOKEN'
    );
  }

  return { token, source };
}

module.exports = {
  getToken,
  getApiUrl,
  requireAuth
};

