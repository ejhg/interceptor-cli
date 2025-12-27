const chalk = require('chalk');
const { loadConfig } = require('./src/loader');
const { createProxyServer } = require('./src/proxy');
const { RequestLogger } = require('./src/request-logger');

function parseCliArgs() {
  const args = process.argv.slice(2);

  // Parse --log-group with its value
  let logGroup = null;
  const logGroupIndex = args.findIndex(arg => arg === '--log-group');
  if (logGroupIndex !== -1 && args[logGroupIndex + 1]) {
    logGroup = args[logGroupIndex + 1];
  }

  // Parse --port with its value
  let port = null;
  const portIndex = args.findIndex(arg => arg === '--port' || arg === '-p');
  if (portIndex !== -1 && args[portIndex + 1]) {
    port = parseInt(args[portIndex + 1], 10);
  }

  return {
    logGroup,
    port,
    help: args.includes('--help') || args.includes('-h')
  };
}

function showHelp() {
  console.log(`
${chalk.bold('Interceptor CLI - Proxy Server')}

${chalk.bold('Usage:')}
  node server.js [options]

${chalk.bold('Options:')}
  --port, -p <port>      Override the port from config file
  --log-group <name>     Save all requests/responses to logs/<name> directory
  --help, -h             Show this help message

${chalk.bold('Environment Variables:')}
  CONFIG_FILE            Path to config file (default: config.yaml)

${chalk.bold('Examples:')}
  node server.js --port 8000
  node server.js --log-group session1        # saves to logs/session1/
  npm run dev -- --port 8000 --log-group test  # saves to logs/test/
  `);
}

function main() {
  const cliArgs = parseCliArgs();

  if (cliArgs.help) {
    showHelp();
    process.exit(0);
  }

  const config = loadConfig();

  if (!config.port || !config.target) {
    console.error(chalk.red('Missing required configuration: port and target must be specified in config file!'));
    process.exit(1);
  }

  // Initialize request logger - log-group is always a subdirectory within logs/
  const logDir = cliArgs.logGroup ? `logs/${cliArgs.logGroup}` : null;
  const requestLogger = new RequestLogger(logDir);

  // Override port from CLI if provided
  const proxyConfig = {
    port: cliArgs.port || config.port,
    target: config.target
  };

  try {
    const server = createProxyServer(proxyConfig, config.logging || {}, requestLogger);

    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n\n👋 Shutting down proxy server...'));
      if (requestLogger.enabled) {
        console.log(chalk.green(`Saved ${requestLogger.getRequestCount()} requests to ${requestLogger.getLogDir()}`));
      }
      server.close();
      process.exit(0);
    });
  } catch (error) {
    console.error(chalk.red(`Failed to start proxy server:`, error.message));
    process.exit(1);
  }
}

main();
