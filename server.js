const chalk = require('chalk');
const { loadConfig } = require('./src/loader');
const { createProxyServer } = require('./src/proxy');

function main() {
  const config = loadConfig();

  if (!config.proxies || config.proxies.length === 0) {
    console.error(chalk.red('No proxies configured in the configuration file!'));
    process.exit(1);
  }

  const servers = [];

  config.proxies.forEach(proxyConfig => {
    try {
      const server = createProxyServer(proxyConfig, config.logging || {});
      servers.push(server);
    } catch (error) {
      console.error(chalk.red(`Failed to start proxy "${proxyConfig.name}":`, error.message));
    }
  });

  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n👋 Shutting down proxy servers...'));
    servers.forEach(server => server.close());
    process.exit(0);
  });
}

main();
