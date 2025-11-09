const chalk = require('chalk');

function logCompact(colorFn, modelKey, method, url, status, duration, cacheInfo, usageInfo) {
  const timestamp = new Date().toISOString().substring(11, 19); // HH:MM:SS format
  const modelDisplay = modelKey ? ` [${modelKey}]` : '';
  const tag = colorFn('>>');

  // Cache status indicators
  let cacheStatus = '';
  if (cacheInfo.isFirstRequest) {
    cacheStatus = chalk.blue(' [FIRST]');
  } else if (cacheInfo.cacheBusted) {
    cacheStatus = chalk.red(' [RESET]');
  } else if (cacheInfo.hasDiff) {
    cacheStatus = chalk.yellow(' [DIFF]');
  } else {
    cacheStatus = chalk.green(' [CACHED]');
  }

  // Usage info from response
  let usageDisplay = '';
  if (usageInfo) {
    const inputTokens = usageInfo.input_tokens || 0;
    const cacheRead = usageInfo.cache_read_input_tokens || 0;
    const cacheCreate = usageInfo.cache_creation_input_tokens || 0;
    const outputTokens = usageInfo.output_tokens || 0;

    if (cacheRead > 0) {
      usageDisplay = ` ${chalk.cyan(`cached:${cacheRead}`)}`;
    }
    if (cacheCreate > 0) {
      usageDisplay += ` ${chalk.magenta(`create:${cacheCreate}`)}`;
    }
    usageDisplay += ` ${chalk.gray(`in:${inputTokens} out:${outputTokens}`)}`;
  }

  console.log(`${tag}${colorFn(modelDisplay)} [${timestamp}] ${method} ${url} → ${status} (${duration}ms)${cacheStatus}${usageDisplay}`);
}

module.exports = { logCompact };
