const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class RequestLogger {
  constructor(logDir = null) {
    this.enabled = !!logDir;
    this.logDir = logDir;
    this.requestCount = 0;

    if (this.enabled) {
      this.initializeLogDirectory();
    }
  }

  simplifyModelName(modelName) {
    if (!modelName) return modelName;
    // Remove date suffixes like -20241022, -20250101, etc.
    return modelName.replace(/-\d{8}$/, '');
  }

  initializeLogDirectory() {
    // Resolve to absolute path
    this.logDir = path.resolve(this.logDir);
    console.log(chalk.green(`✓ Request logging enabled. Saving to: ${this.logDir}`));
  }

  async saveRequest(requestData, responseData) {
    if (!this.enabled || !this.logDir) {
      return;
    }

    this.requestCount++;

    // Ensure directory exists every time (in case user deleted it)
    try {
      await fs.promises.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      console.error(chalk.red(`Failed to create log directory: ${error.message}`));
      return;
    }

    // Generate timestamp-based filename: YYYY-MM-DD_HH-MM-SS-mmm
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];

    // Add model name suffix if available (simplified to remove date suffixes)
    const modelSuffix = requestData.modelKey ? `.${this.simplifyModelName(requestData.modelKey)}` : '';
    const baseFilename = `${timestamp}${modelSuffix}`;

    // Separate files for request and response with .json extension
    const requestFilepath = path.join(this.logDir, `${baseFilename}.request.json`);
    const responseFilepath = path.join(this.logDir, `${baseFilename}.response.json`);

    const requestLog = {
      method: requestData.method,
      url: requestData.url,
      headers: requestData.headers,
      query: requestData.query,
      body: requestData.body,
      modelKey: requestData.modelKey
    };

    const responseLog = {
      status: responseData.status,
      statusText: responseData.statusText,
      headers: responseData.headers,
      data: responseData.data,
      duration: responseData.duration
    };

    // Include error if present
    if (responseData.error) {
      responseLog.error = responseData.error;
    }

    try {
      await fs.promises.writeFile(requestFilepath, JSON.stringify(requestLog, null, 2), 'utf8');
      await fs.promises.writeFile(responseFilepath, JSON.stringify(responseLog, null, 2), 'utf8');
    } catch (error) {
      console.error(chalk.red(`Failed to save request ${this.requestCount}: ${error.message}`));
    }
  }

  getLogDir() {
    return this.logDir;
  }

  getRequestCount() {
    return this.requestCount;
  }
}

module.exports = { RequestLogger };
