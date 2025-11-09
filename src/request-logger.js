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

  initializeLogDirectory() {
    try {
      // Resolve to absolute path
      this.logDir = path.resolve(this.logDir);
      fs.mkdirSync(this.logDir, { recursive: true });
      console.log(chalk.green(`✓ Request logging enabled. Saving to: ${this.logDir}`));
    } catch (error) {
      console.error(chalk.red(`Failed to create log directory: ${error.message}`));
      this.enabled = false;
    }
  }

  async saveRequest(requestData, responseData) {
    if (!this.enabled || !this.logDir) {
      return;
    }

    this.requestCount++;

    // Generate timestamp-based filename: YYYY-MM-DD_HH-MM-SS-mmm.json
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
    const filename = `${timestamp}.json`;
    const filepath = path.join(this.logDir, filename);

    const logData = {
      timestamp: new Date().toISOString(),
      requestNumber: this.requestCount,
      request: {
        method: requestData.method,
        url: requestData.url,
        headers: requestData.headers,
        query: requestData.query,
        body: requestData.body,
        modelKey: requestData.modelKey
      },
      response: {
        status: responseData.status,
        statusText: responseData.statusText,
        headers: responseData.headers,
        data: responseData.data,
        duration: responseData.duration
      }
    };

    // Include error if present
    if (responseData.error) {
      logData.response.error = responseData.error;
    }

    try {
      await fs.promises.writeFile(filepath, JSON.stringify(logData, null, 2), 'utf8');
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
