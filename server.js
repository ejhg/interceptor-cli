const express = require('express');
const axios = require('axios');
const chalk = require('chalk');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const diff = require('deep-diff');

const CONFIG_FILE = process.env.CONFIG_FILE || 'config.yaml';

// cache by model string
const requestCache = new Map();

function loadConfig() {
  try {
    const fileContents = fs.readFileSync(path.resolve(CONFIG_FILE), 'utf8');
    return yaml.load(fileContents);
  } catch (e) {
    console.error(chalk.red('Error loading configuration file:'), e.message);
    process.exit(1);
  }
}

const colorRotation = [
  chalk.cyan,
  chalk.green,
  chalk.yellow,
  chalk.magenta,
  chalk.blue,
  chalk.redBright,
  chalk.greenBright,
  chalk.yellowBright,
  chalk.cyanBright,
  chalk.magentaBright
];

let colorIndex = 0;

function getNextColor() {
  const color = colorRotation[colorIndex];
  colorIndex = (colorIndex + 1) % colorRotation.length;
  return color;
}

function formatHeaders(headers) {
  const filtered = { ...headers };
  delete filtered.host;
  return JSON.stringify(filtered, null, 2);
}

function formatBody(body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return bodyStr || '';
}

function formatDiff(differences, colorFn) {
  if (!differences || differences.length === 0) {
    return colorFn('  No differences from cached request');
  }
  
  const output = [];
  differences.forEach(d => {
    switch(d.kind) {
      case 'N': // New property
        output.push(chalk.green(`  + Added: ${d.path.join('.')} = ${JSON.stringify(d.rhs)}`));
        break;
      case 'D': // Deleted property
        output.push(chalk.red(`  - Removed: ${d.path.join('.')}`));
        break;
      case 'E': // Edited property
        output.push(chalk.yellow(`  ~ Changed: ${d.path.join('.')}`));
        output.push(chalk.red(`    - ${JSON.stringify(d.lhs)}`));
        output.push(chalk.green(`    + ${JSON.stringify(d.rhs)}`));
        break;
      case 'A': // Array change
        output.push(chalk.yellow(`  ~ Array changed: ${d.path.join('.')}[${d.index}]`));
        if (d.item.kind === 'N') {
          output.push(chalk.green(`    + ${JSON.stringify(d.item.rhs)}`));
        } else if (d.item.kind === 'D') {
          output.push(chalk.red(`    - ${JSON.stringify(d.item.lhs)}`));
        } else if (d.item.kind === 'E') {
          output.push(chalk.red(`    - ${JSON.stringify(d.item.lhs)}`));
          output.push(chalk.green(`    + ${JSON.stringify(d.item.rhs)}`));
        }
        break;
    }
  });
  
  return output.join('\n');
}

function createProxyServer(proxyConfig, loggingConfig) {
  const app = express();
  
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use(express.raw({ type: '*/*', limit: '50mb' }));

  app.use(async (req, res) => {
    const colorFn = getNextColor();
    const timestamp = new Date().toISOString();
    const method = req.method;
    const url = req.url;
    const targetUrl = `${proxyConfig.target}${url}`;
    
    console.log('\n' + colorFn('━'.repeat(80)));
    console.log(colorFn(`[${timestamp}] ${proxyConfig.name} (Port ${proxyConfig.port})`));
    console.log(colorFn('━'.repeat(80)));
    
    console.log(chalk.bold('Request:'), `${method} ${url}`);
    console.log(chalk.bold('Target:'), targetUrl);
    
    if (loggingConfig.showQuery && Object.keys(req.query).length > 0) {
      console.log(chalk.bold('\nQuery Parameters:'));
      console.log(colorFn(JSON.stringify(req.query, null, 2)));
    }
    
    if (loggingConfig.showHeaders) {
      console.log(chalk.bold('\nRequest Headers:'));
      console.log(colorFn(formatHeaders(req.headers)));
    }
    
    if (loggingConfig.showBody && req.body) {
      const bodyContent = req.body instanceof Buffer ? req.body.toString() : req.body;
      
      // Check if body is JSON and has a model property
      let isJsonWithModel = false;
      let parsedBody = null;
      let modelKey = null;
      
      try {
        parsedBody = typeof bodyContent === 'string' ? JSON.parse(bodyContent) : bodyContent;
        if (parsedBody && typeof parsedBody === 'object' && parsedBody.model) {
          isJsonWithModel = true;
          modelKey = parsedBody.model;
        }
      } catch (e) {
        // Not JSON or parsing error, treat as regular body
      }
      
      if (isJsonWithModel && modelKey) {
        const cachedRequest = requestCache.get(modelKey);
        
        if (cachedRequest) {
          console.log(chalk.bold('\nRequest Body') + chalk.gray(` (model: ${modelKey}) - Showing diff from previous request:`));
          const differences = diff.diff(cachedRequest, parsedBody);
          console.log(formatDiff(differences, colorFn));
          
          // Show full body in collapsed/dimmed format
          console.log(chalk.dim('\nFull request body:'));
          console.log(chalk.dim(colorFn(formatBody(parsedBody))));
        } else {
          console.log(chalk.bold('\nRequest Body') + chalk.gray(` (model: ${modelKey}) - First request, caching...`));
          console.log(colorFn(formatBody(parsedBody)));
        }
        
        // Update cache with the new request
        requestCache.set(modelKey, parsedBody);
      } else {
        console.log(chalk.bold('\nRequest Body:'));
        console.log(colorFn(formatBody(bodyContent)));
      }
    }

    try {
      const headers = { ...req.headers };
      delete headers.host;
      delete headers['content-length'];
      
      const requestConfig = {
        method: req.method,
        url: targetUrl,
        headers: headers,
        params: req.query,
        maxRedirects: 5,
        validateStatus: () => true
      };

      if (req.body) {
        requestConfig.data = req.body instanceof Buffer ? req.body.toString() : req.body;
      }

      console.log(chalk.dim('\n⏳ Proxying request...'));
      const startTime = Date.now();
      
      const response = await axios(requestConfig);
      
      const duration = Date.now() - startTime;
      console.log(chalk.bold('\n✓ Response received:'), `${response.status} ${response.statusText} (${duration}ms)`);
      
      if (loggingConfig.showResponse) {
        if (loggingConfig.showHeaders) {
          console.log(chalk.bold('\nResponse Headers:'));
          console.log(colorFn(JSON.stringify(response.headers, null, 2)));
        }
        
        if (response.data) {
          console.log(chalk.bold('\nResponse Body:'));
          const responseBody = typeof response.data === 'string' 
            ? response.data 
            : JSON.stringify(response.data, null, 2);
          console.log(colorFn(formatBody(responseBody)));
        }
      }
      
      Object.entries(response.headers).forEach(([key, value]) => {
        if (key.toLowerCase() !== 'content-encoding' && 
            key.toLowerCase() !== 'transfer-encoding') {
          res.setHeader(key, value);
        }
      });
      
      res.status(response.status).send(response.data);
      
    } catch (error) {
      console.error(chalk.red.bold('\n✗ Proxy Error:'), error.message);
      if (error.response) {
        console.error(chalk.red('Response Status:'), error.response.status);
        console.error(chalk.red('Response Data:'), error.response.data);
      }
      
      res.status(error.response?.status || 500).json({
        error: 'Proxy Error',
        message: error.message,
        target: targetUrl
      });
    }
    
    console.log(colorFn('━'.repeat(80) + '\n'));
  });

  const server = app.listen(proxyConfig.port, () => {
    console.log(chalk.bold.white(`🚀 ${proxyConfig.name} proxy started on port ${proxyConfig.port}`));
    console.log(chalk.gray(`   ↳ Proxying to: ${proxyConfig.target}`));
  });

  return server;
}

function main() {
  console.log(chalk.bold.blue('\n🔧 Multi-Port Proxy Server Starting...\n'));
  
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
  
  console.log(chalk.bold.green(`\n✅ All ${servers.length} proxy servers started successfully!\n`));
  
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n👋 Shutting down proxy servers...'));
    servers.forEach(server => server.close());
    process.exit(0);
  });
}

main();