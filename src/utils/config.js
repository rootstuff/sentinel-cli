const Conf = require('conf');

/**
 * Persistent CLI configuration (token, API URL, default output format).
 *
 * SENTINEL_CONFIG_DIR overrides the directory the config file lives in, which
 * keeps CI runners and the test suite away from the developer's own config.
 */
const config = new Conf({
  projectName: 'sentinel',
  projectSuffix: '',
  cwd: process.env.SENTINEL_CONFIG_DIR || undefined,
  defaults: {
    apiUrl: 'https://sentinel.rootstuff.io',
    token: null,
    defaultFormat: 'table'
  }
});

module.exports = {
  get: (key) => config.get(key),
  set: (key, value) => config.set(key, value),
  delete: (key) => config.delete(key),
  clear: () => config.clear(),
  has: (key) => config.has(key),
  getAll: () => config.store,
  path: config.path
};
