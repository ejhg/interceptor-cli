const express = require('express');
const axios = require('axios');
const chalk = require('chalk');
const { getNextColor } = require('./logging/colors');
const { formatHeaders, formatBody, logWithOptionalColor, formatDiff } = require('./logging/formatters');
const { logCompact } = require('./logging/compact');
const { getCachedData, updateCache, updateResponseHeaders, analyzeCacheStatus } = require('./request-cache');
const { isSSEResponse, formatSSEResponse, parseSSE, reconstructMessageFromSSE } = require('./sse-parser');

function createProxyServer(proxyConfig, loggingConfig, requestLogger = null) {
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

    // Cache tracking for compact mode
    const cacheInfo = {
      isFirstRequest: false,
      cacheBusted: false,
      hasDiff: false
    };

    const modelDisplay = modelKey ? ` [${modelKey}]` : '';
    const requestTag = colorFn('>>');
    const responseTag = colorFn('<<');

    // Use compact mode if enabled
    if (!loggingConfig.compact) {
      console.log('\n' + colorFn('━'.repeat(80)));
      console.log(`${requestTag}${colorFn(modelDisplay)} [${timestamp}] ${method} ${url}`);
    }

    if (loggingConfig.showQuery && !loggingConfig.compact && Object.keys(req.query).length > 0) {
      console.log(`\n${requestTag}${modelDisplay} ${chalk.bold('Query Parameters:')}`);
      console.log(logWithOptionalColor(JSON.stringify(req.query, null, 2), colorFn, modelKey, false, loggingConfig.useColorTag));
    }

    // Handle headers - show diff if we have a cached request with the same model
    if (loggingConfig.showHeaders && !loggingConfig.compact) {
      const filteredHeaders = { ...req.headers };
      delete filteredHeaders.host;

      if (isJsonWithModel && modelKey) {
        const cachedData = getCachedData(modelKey);

        if (cachedData && cachedData.headers) {
          console.log(`\n${requestTag}${modelDisplay} ${chalk.bold('Request Headers')}${chalk.gray(' - Showing diff from previous request:')}`);
          const cacheAnalysis = analyzeCacheStatus(modelKey, parsedBody, filteredHeaders);
          if (cacheAnalysis.headerDiff && cacheAnalysis.headerDiff.length > 0) {
            console.log(formatDiff(cacheAnalysis.headerDiff, colorFn));
          } else {
            console.log(logWithOptionalColor('  No header changes', colorFn, modelKey, false, loggingConfig.useColorTag));
          }
        } else {
          console.log(`\n${requestTag}${modelDisplay} ${chalk.bold('Headers:')}`);
          console.log(logWithOptionalColor(formatHeaders(filteredHeaders), colorFn, modelKey, false, loggingConfig.useColorTag));
        }
      } else {
        console.log(`\n${requestTag}${modelDisplay} ${chalk.bold('Headers:')}`);
        console.log(logWithOptionalColor(formatHeaders(req.headers), colorFn, modelKey, false, loggingConfig.useColorTag));
      }
    }

    // Handle body
    if (loggingConfig.showBody && bodyContent) {
      if (isJsonWithModel && modelKey) {
        const filteredHeaders = { ...req.headers };
        delete filteredHeaders.host;

        const cacheAnalysis = analyzeCacheStatus(modelKey, parsedBody, filteredHeaders);

        cacheInfo.isFirstRequest = cacheAnalysis.isFirstRequest;
        cacheInfo.cacheBusted = cacheAnalysis.cacheBusted;
        cacheInfo.hasDiff = cacheAnalysis.bodyDiff && cacheAnalysis.bodyDiff.length > 0;

        if (cacheAnalysis.shouldDiff) {
          if (!loggingConfig.compact) {
            console.log(`\n${requestTag}${modelDisplay} ${chalk.bold('Request Body')}${chalk.gray(' - Showing diff from previous request:')}`);
            console.log(formatDiff(cacheAnalysis.bodyDiff, colorFn));
          }
        } else if (cacheAnalysis.cacheBusted && !loggingConfig.compact) {
          console.log(`\n${requestTag} ${chalk.bold('Request Body')}${chalk.gray(` (model: ${modelKey}) - Cache busted (messages array reset), starting fresh...`)}`);
          console.log(logWithOptionalColor(formatBody(parsedBody), colorFn, modelKey, false, loggingConfig.useColorTag));
        } else if (cacheAnalysis.isFirstRequest && !loggingConfig.compact) {
          console.log(`\n${requestTag} ${chalk.bold('Request Body')}${chalk.gray(` (model: ${modelKey}) - First request, caching...`)}`);
          console.log(logWithOptionalColor(formatBody(parsedBody), colorFn, modelKey, false, loggingConfig.useColorTag));
        }

        // Update cache with the new request (including headers)
        updateCache(modelKey, parsedBody, filteredHeaders);
      } else {
        console.log(`\n${requestTag} ${chalk.bold('Request Body:')}`);
        console.log(logWithOptionalColor(formatBody(bodyContent), colorFn, modelKey, false, loggingConfig.useColorTag));
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

      // Parse response data to normalized JSON format for logging
      let normalizedResponseData = response.data;
      let usageInfo = null;

      if (response.data && typeof response.data === 'object') {
        // Already an object
        usageInfo = response.data.usage;
      } else if (typeof response.data === 'string') {
        // Check if this is an SSE response first
        if (isSSEResponse(response.headers)) {
          // Parse SSE to get the reconstructed message
          const events = parseSSE(response.data);
          const reconstructed = reconstructMessageFromSSE(events);
          if (reconstructed) {
            normalizedResponseData = reconstructed;
            usageInfo = reconstructed.usage;
          }
        } else {
          // Try to parse as JSON
          try {
            const parsed = JSON.parse(response.data);
            normalizedResponseData = parsed;
            usageInfo = parsed.usage;
          } catch (e) {
            // Not JSON, keep as string
          }
        }
      }

      // Use compact logging if enabled
      if (loggingConfig.compact) {
        logCompact(colorFn, modelKey, method, url, response.status, duration, cacheInfo, usageInfo);
      } else {
        console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('✓ Received:')} ${response.status} ${response.statusText} (${duration}ms)`);
      }

      if (loggingConfig.showResponse && !loggingConfig.compact) {
        if (loggingConfig.showHeaders) {
          // Handle response headers diff if we have cached data
          if (isJsonWithModel && modelKey) {
            const cachedData = getCachedData(modelKey);

            if (cachedData && cachedData.responseHeaders) {
              console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('Headers')}${chalk.gray(' - Showing diff:')}`);
              const diff = require('deep-diff');
              const responseHeaderDiffs = diff.diff(cachedData.responseHeaders, response.headers);
              if (responseHeaderDiffs && responseHeaderDiffs.length > 0) {
                console.log(formatDiff(responseHeaderDiffs, colorFn));
              } else {
                console.log(logWithOptionalColor('  No response header changes', colorFn, modelKey, true, loggingConfig.useColorTag));
              }
            } else {
              console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('Headers:')}`);
              console.log(logWithOptionalColor(JSON.stringify(response.headers, null, 2), colorFn, modelKey, true, loggingConfig.useColorTag));
            }

            // Update cached response headers
            updateResponseHeaders(modelKey, response.headers);
          } else {
            console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('Headers:')}`);
            console.log(logWithOptionalColor(JSON.stringify(response.headers, null, 2), colorFn, modelKey, true, loggingConfig.useColorTag));
          }
        }

        if (response.data) {
          // Check if this is an SSE response
          if (isSSEResponse(response.headers)) {
            console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('Body')}${chalk.gray(' (SSE stream):')}`);
            const formattedSSE = formatSSEResponse(response.data, colorFn);
            console.log(logWithOptionalColor(formattedSSE, colorFn, modelKey, true, loggingConfig.useColorTag));
          } else {
            console.log(`\n${responseTag}${modelDisplay} ${chalk.bold('Body:')}`);
            const responseBody = typeof response.data === 'string'
              ? response.data
              : JSON.stringify(response.data, null, 2);
            console.log(logWithOptionalColor(formatBody(responseBody), colorFn, modelKey, true, loggingConfig.useColorTag));
          }
        }
      }

      Object.entries(response.headers).forEach(([key, value]) => {
        if (key.toLowerCase() !== 'content-encoding' &&
            key.toLowerCase() !== 'transfer-encoding') {
          res.setHeader(key, value);
        }
      });

      // Save request/response if logging is enabled
      if (requestLogger && requestLogger.enabled) {
        await requestLogger.saveRequest(
          {
            method,
            url,
            headers: req.headers,
            query: req.query,
            body: parsedBody || bodyContent,
            modelKey
          },
          {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: normalizedResponseData,
            duration
          }
        );
      }

      res.status(response.status).send(response.data);

    } catch (error) {
      if (loggingConfig.compact) {
        logCompact(colorFn, modelKey, method, url, error.response?.status || 500, 0, cacheInfo, null);
      } else {
        console.error(`\n${responseTag}${modelDisplay} ${chalk.red.bold('✗ Error:')} ${error.message}`);
        if (error.response) {
          console.error(`${responseTag}${modelDisplay} ${chalk.red('Status:')} ${error.response.status}`);
          console.error(`${responseTag}${modelDisplay} ${chalk.red('Data:')} ${error.response.data}`);
        }
      }

      // Save error response if logging is enabled
      if (requestLogger && requestLogger.enabled) {
        await requestLogger.saveRequest(
          {
            method,
            url,
            headers: req.headers,
            query: req.query,
            body: parsedBody || bodyContent,
            modelKey
          },
          {
            status: error.response?.status || 500,
            statusText: error.response?.statusText || 'Error',
            headers: error.response?.headers || {},
            data: error.response?.data || { error: error.message },
            duration: 0,
            error: error.message
          }
        );
      }

      res.status(error.response?.status || 500).json({
        error: 'Proxy Error',
        message: error.message,
        target: targetUrl
      });
    }

    if (!loggingConfig.compact) {
      console.log(colorFn('━'.repeat(80) + '\n'));
    }
  });

  const server = app.listen(proxyConfig.port, () => {
    console.log(chalk.bold.white(`Proxy server started on port ${proxyConfig.port}`));
    console.log(chalk.gray(`   ↳ Proxying to: ${proxyConfig.target}`));
    console.log(chalk.cyan(`   ↳ Run claude with \`ANTHROPIC_BASE_URL=http://localhost:${proxyConfig.port} claude\``));
  });

  return server;
}

module.exports = { createProxyServer };
