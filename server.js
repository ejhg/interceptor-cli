const chalk = require('chalk');
const { loadConfig } = require('./src/loader');
const { createProxyServer } = require('./src/proxy');
const { RequestLogger } = require('./src/request-logger');

function parseCliArgs() {
  const args = process.argv.slice(2);

  // Parse --log-dir with its value
  let logDir = null;
  const logDirIndex = args.findIndex(arg => arg === '--log-dir');
  if (logDirIndex !== -1 && args[logDirIndex + 1]) {
    logDir = args[logDirIndex + 1];
  }

  return {
    logDir,
    help: args.includes('--help') || args.includes('-h')
  };
}

function showHelp() {
  console.log(`
${chalk.bold('Interceptor CLI - Proxy Server')}

${chalk.bold('Usage:')}
  node server.js [options]

${chalk.bold('Options:')}
  --log-dir <path>    Save all requests/responses to specified directory
  --help, -h          Show this help message

${chalk.bold('Environment Variables:')}
  CONFIG_FILE         Path to config file (default: config.yaml)

${chalk.bold('Examples:')}
  node server.js --log-dir ./logs
  npm run dev -- --log-dir ./requests
  `);
}

function main() {
  const cliArgs = parseCliArgs();

  if (cliArgs.help) {
    showHelp();
    process.exit(0);
  }

  const config = loadConfig();

  if (!config.proxies || config.proxies.length === 0) {
    console.error(chalk.red('No proxies configured in the configuration file!'));
    process.exit(1);
  }

  // Initialize request logger
  const requestLogger = new RequestLogger(cliArgs.logDir);

  const servers = [];

  config.proxies.forEach(proxyConfig => {
    try {
      const server = createProxyServer(proxyConfig, config.logging || {}, requestLogger);
      servers.push(server);
    } catch (error) {
      console.error(chalk.red(`Failed to start proxy "${proxyConfig.name}":`, error.message));
    }
  });

  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n👋 Shutting down proxy servers...'));
    if (requestLogger.enabled) {
      console.log(chalk.green(`Saved ${requestLogger.getRequestCount()} requests to ${requestLogger.getLogDir()}`));
    }
    servers.forEach(server => server.close());
    process.exit(0);
  });
}

main();
