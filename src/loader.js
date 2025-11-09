const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const CONFIG_FILE = process.env.CONFIG_FILE || 'config.yaml';

function loadConfig() {
  try {
    const fileContents = fs.readFileSync(path.resolve(CONFIG_FILE), 'utf8');
    return yaml.load(fileContents);
  } catch (e) {
    console.error(chalk.red('Error loading configuration file:'), e.message);
    process.exit(1);
  }
}

module.exports = { loadConfig };
