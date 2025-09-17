function parseSSE(sseData) {
  const lines = sseData.split('\n');
  const events = [];
  let currentEvent = null;
  
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      if (currentEvent) events.push(currentEvent);
      currentEvent = { event: line.substring(7), data: null };
    } else if (line.startsWith('data: ') && currentEvent) {
      const dataStr = line.substring(6).trim();
      if (dataStr) {
        try {
          currentEvent.data = JSON.parse(dataStr);
        } catch (e) {
          currentEvent.data = dataStr;
        }
      }
    }
  }
  if (currentEvent) events.push(currentEvent);
  
  return events;
}

function reconstructMessageFromSSE(events) {
  let message = null;
  let contentBlocks = [];
  
  for (const event of events) {
    if (event.event === 'message_start' && event.data?.message) {
      message = { ...event.data.message };
      message.content = [];
    } else if (event.event === 'content_block_start' && event.data?.content_block) {
      contentBlocks[event.data.index] = { ...event.data.content_block };
    } else if (event.event === 'content_block_delta' && event.data?.delta?.text) {
      if (contentBlocks[event.data.index]) {
        contentBlocks[event.data.index].text = (contentBlocks[event.data.index].text || '') + event.data.delta.text;
      }
    } else if (event.event === 'message_delta' && event.data?.delta) {
      if (message) {
        message.stop_reason = event.data.delta.stop_reason || message.stop_reason;
        if (event.data.usage) {
          message.usage = { ...message.usage, ...event.data.usage };
        }
      }
    }
  }
  
  if (message && contentBlocks.length > 0) {
    message.content = contentBlocks;
  }
  
  return message;
}

function isSSEResponse(headers) {
  const contentType = headers['content-type'] || '';
  return contentType.includes('text/event-stream');
}

function formatSSEResponse(sseData, colorFn) {
  const events = parseSSE(sseData);
  const reconstructed = reconstructMessageFromSSE(events);
  
  if (reconstructed) {
    return JSON.stringify(reconstructed, null, 2);
  } else {
    // Not a structured SSE stream, show raw
    return sseData;
  }
}

module.exports = {
  isSSEResponse,
  formatSSEResponse,
  parseSSE,
  reconstructMessageFromSSE
};