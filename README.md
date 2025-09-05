# Multi-Port Proxy Server

A Node.js application that can listen on multiple ports simultaneously and proxy requests to different target endpoints with rich, color-coded console logging.

## Installation

```bash
npm install
```

## Configuration

### Logging Options
- `showHeaders`: Display headers in logs
- `showBody`: Display request/response bodies
- `showQuery`: Display query parameters
- `showResponse`: Display response data
- `maxBodyLength`: Maximum characters for body display

## Usage

```bash
# Start with default config.yaml
npm start

# Start with custom config file
CONFIG_FILE=myconfig.yaml npm start

# Development mode with auto-reload
npm run dev
```

## Testing

You can test the proxies using curl:

```bash
# Test a GET request
curl http://localhost:3001/users

# Test a POST request
curl -X POST http://localhost:3002/post \
  -H "Content-Type: application/json" \
  -d '{"name": "test"}'
```