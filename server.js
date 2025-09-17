const express = require('express');
const axios = require('axios');
const chalk = require('chalk');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const diff = require('deep-diff');
const { isSSEResponse, formatSSEResponse } = require('./sse-parser');

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

function addColorTag(text, colorFn, modelKey, isResponse = false) {
  const arrow = isResponse ? '<<' : '>>';
  const tag = colorFn(arrow);
  const modelDisplay = modelKey ? colorFn(` [${modelKey}]`) : '';
  return text.split('\n').map(line => `${tag}${modelDisplay} ${line}`).join('\n');
}

function formatDiff(differences, colorFn) {
  if (!differences || differences.length === 0) {
    return colorFn('  No differences from cached request');
  }
  
  // Sort differences to ensure array changes are in order
  const sortedDiffs = [...differences].sort((a, b) => {
    // Compare paths element by element
    const pathA = a.path || [];
    const pathB = b.path || [];
    
    for (let i = 0; i < Math.min(pathA.length, pathB.length); i++) {
      if (pathA[i] !== pathB[i]) {
        // If one is a number (array index) and one isn't, put non-numbers first
        if (typeof pathA[i] === 'number' && typeof pathB[i] === 'number') {
          return pathA[i] - pathB[i];
        }
        return String(pathA[i]).localeCompare(String(pathB[i]));
      }
    }
    
    // If paths are equal up to this point, also compare array indices for 'A' type
    if (a.kind === 'A' && b.kind === 'A' && a.index !== undefined && b.index !== undefined) {
      return a.index - b.index;
    }
    
    return pathA.length - pathB.length;
  });
  
  const output = [];
  sortedDiffs.forEach(d => {
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
    
    // Process body early to get model key for header display
    const bodyContent = req.body ? (req.body instanceof Buffer ? req.body.toString() : req.body) : null;
    let isJsonWithModel = false;
    let parsedBody = null;
    let modelKey = null;
    
    // Check if body is JSON and has a model property
    if (bodyContent) {
      try {
        parsedBody = typeof bodyContent === 'string' ? JSON.parse(bodyContent) : bodyContent;
        if (parsedBody && typeof parsedBody === 'object' && parsedBody.model) {
          isJsonWithModel = true;
          modelKey = parsedBody.model;
        }
      } catch (e) {
        // Not JSON or parsing error, treat as regular body
      }
    }
    
    const modelDisplay = modelKey ? ` [${modelKey}]` : '';
    const requestTag = colorFn('>>');
    const responseTag = colorFn('<<');
    console.log('\n' + colorFn('━'.repeat(80)));
    console.log(`${requestTag}${colorFn(modelDisplay)} [${timestamp}] ${proxyConfig.name}:${proxyConfig.port} | ${method} ${url}`);
    
    if (loggingConfig.showQuery && Object.keys(req.query).length > 0) {
      console.log(`\n${requestTag}${modelDisplay} ${chalk.bold('Query Parameters:')}`);
      console.log(addColorTag(JSON.stringify(req.query, null, 2), colorFn, modelKey));
    }
    
    // Handle headers - show diff if we have a cached request with the same model
    if (loggingConfig.showHeaders) {
      const filteredHeaders = { ...req.headers };
      delete filteredHeaders.host;
      
      if (isJsonWithModel && modelKey) {
        const cachedData = requestCache.get(modelKey);
        
        if (cachedData && cachedData.headers) {
          console.log(`\n${requestTag}${modelDisplay} ${chalk.bold('Request Headers')}${chalk.gray(' - Showing diff from previous request:')}`);
          const headerDiffs = diff.diff(cachedData.headers, filteredHeaders);
          if (headerDiffs && headerDiffs.length > 0) {
            console.log(formatDiff(headerDiffs, colorFn));
          } else {
            console.log(addColorTag('  No header changes', colorFn, modelKey));
          }
        } else {
          console.log(`\n${requestTag}${modelDisplay} ${chalk.bold('Headers:')}`);
          console.log(addColorTag(formatHeaders(filteredHeaders), colorFn, modelKey));
        }
      } else {
        console.log(`\n${requestTag}${modelDisplay} ${chalk.bold('Headers:')}`);
        console.log(addColorTag(formatHeaders(req.headers), colorFn, modelKey));
      }
    }
    
    // Handle body
    if (loggingConfig.showBody && bodyContent) {
      if (isJsonWithModel && modelKey) {
        const cachedData = requestCache.get(modelKey);
        
        // Check messages array logic
        let shouldDiff = false;
        let cacheBusted = false;
        
        if (cachedData) {
          const currentMessages = parsedBody.messages || [];
          const cachedMessages = cachedData.body?.messages || [];
          
          if (currentMessages.length >= cachedMessages.length) {
            shouldDiff = true;
          } else {
            cacheBusted = true;
            requestCache.delete(modelKey);
          }
        }
        
        if (cachedData && shouldDiff) {
          console.log(`\n${requestTag}${modelDisplay} ${chalk.bold('Request Body')}${chalk.gray(' - Showing diff from previous request:')}`);
          const differences = diff.diff(cachedData.body, parsedBody);
          console.log(formatDiff(differences, colorFn));
        } else if (cacheBusted) {
          console.log(`\n${requestTag} ${chalk.bold('Request Body')}${chalk.gray(` (model: ${modelKey}) - Cache busted (messages array reset), starting fresh...`)}`);
          console.log(addColorTag(formatBody(parsedBody), colorFn, modelKey));
        } else {
          console.log(`\n${requestTag} ${chalk.bold('Request Body')}${chalk.gray(` (model: ${modelKey}) - First request, caching...`)}`);
          console.log(addColorTag(formatBody(parsedBody), colorFn, modelKey));
        }
        
        // Update cache with the new request (including headers)
        // Preserve responseHeaders from previous cache if they exist
        const filteredHeaders = { ...req.headers };
        delete filteredHeaders.host;
        const existingCache = requestCache.get(modelKey);
        requestCache.set(modelKey, {
          body: parsedBody,
          headers: filteredHeaders,
          responseHeaders: existingCache?.responseHeaders // Preserve response headers from previous request
        });
      } else {
        console.log(`\n${requestTag} ${chalk.bold('Request Body:')}`);
        console.log(addColorTag(formatBody(bodyContent), colorFn, modelKey));
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

      const startTime = Date.now();
      
      const response = await axios(requestConfig);
      
      const duration = Date.now() - startTime;
      console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('✓ Received:')} ${response.status} ${response.statusText} (${duration}ms)`);
      
      if (loggingConfig.showResponse) {
        if (loggingConfig.showHeaders) {
          // Handle response headers diff if we have cached data
          if (isJsonWithModel && modelKey) {
            const cachedData = requestCache.get(modelKey);
            
            if (cachedData && cachedData.responseHeaders) {
              console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('Headers')}${chalk.gray(' - Showing diff:')}`);
              const responseHeaderDiffs = diff.diff(cachedData.responseHeaders, response.headers);
              if (responseHeaderDiffs && responseHeaderDiffs.length > 0) {
                console.log(formatDiff(responseHeaderDiffs, colorFn));
              } else {
                console.log(addColorTag('  No response header changes', colorFn, modelKey, true));
              }
            } else {
              console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('Headers:')}`);
              console.log(addColorTag(JSON.stringify(response.headers, null, 2), colorFn, modelKey, true));
            }
            
            // Update cached response headers
            if (cachedData) {
              cachedData.responseHeaders = response.headers;
              requestCache.set(modelKey, cachedData);
            }
          } else {
            console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('Headers:')}`);
            console.log(addColorTag(JSON.stringify(response.headers, null, 2), colorFn, modelKey, true));
          }
        }
        
        if (response.data) {
          // Check if this is an SSE response
          if (isSSEResponse(response.headers)) {
            console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('Body')}${chalk.gray(' (SSE stream):')}`);
            const formattedSSE = formatSSEResponse(response.data, colorFn);
            console.log(addColorTag(formattedSSE, colorFn, modelKey, true));
          } else {
            console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('Body:')}`);
            const responseBody = typeof response.data === 'string' 
              ? response.data 
              : JSON.stringify(response.data, null, 2);
            console.log(addColorTag(formatBody(responseBody), colorFn, modelKey, true));
          }
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
      console.error(`\n${responseTag}${modelDisplay} ${chalk.red.bold('✗ Error:')} ${error.message}`);
      if (error.response) {
        console.error(`${responseTag}${modelDisplay} ${chalk.red('Status:')} ${error.response.status}`);
        console.error(`${responseTag}${modelDisplay} ${chalk.red('Data:')} ${error.response.data}`);
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
    console.log(chalk.bold.white(`${proxyConfig.name} proxy started on port ${proxyConfig.port}`));
    console.log(chalk.gray(`   ↳ Proxying to: ${proxyConfig.target}`));
    console.log(chalk.cyan(`   ↳ Run claude with \`ANTHROPIC_BASE_URL=http://localhost:${proxyConfig.port} claude\``));
  });

  return server;
}

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