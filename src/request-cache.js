const diff = require('deep-diff');

// cache by model string
const requestCache = new Map();

function getCachedData(modelKey) {
  return requestCache.get(modelKey);
}

function updateCache(modelKey, body, headers, responseHeaders = null) {
  const existingCache = requestCache.get(modelKey);
  requestCache.set(modelKey, {
    body,
    headers,
    responseHeaders: responseHeaders || existingCache?.responseHeaders
  });
}

function updateResponseHeaders(modelKey, responseHeaders) {
  const cachedData = requestCache.get(modelKey);
  if (cachedData) {
    cachedData.responseHeaders = responseHeaders;
    requestCache.set(modelKey, cachedData);
  }
}

function bustCache(modelKey) {
  requestCache.delete(modelKey);
}

function analyzeCacheStatus(modelKey, currentBody, currentHeaders) {
  const cachedData = requestCache.get(modelKey);

  if (!cachedData) {
    return {
      isFirstRequest: true,
      cacheBusted: false,
      shouldDiff: false,
      bodyDiff: null,
      headerDiff: null
    };
  }

  const currentMessages = currentBody.messages || [];
  const cachedMessages = cachedData.body?.messages || [];

  // Check if messages array was reset (current < cached)
  if (currentMessages.length < cachedMessages.length) {
    bustCache(modelKey);
    return {
      isFirstRequest: false,
      cacheBusted: true,
      shouldDiff: false,
      bodyDiff: null,
      headerDiff: null
    };
  }

  // Calculate diffs
  const bodyDiff = diff.diff(cachedData.body, currentBody);
  const headerDiff = diff.diff(cachedData.headers, currentHeaders);

  return {
    isFirstRequest: false,
    cacheBusted: false,
    shouldDiff: true,
    bodyDiff,
    headerDiff
  };
}

module.exports = {
  getCachedData,
  updateCache,
  updateResponseHeaders,
  bustCache,
  analyzeCacheStatus
};
