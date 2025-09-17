# Multi-Port Proxy Server

A Node.js application that can listen on multiple ports simultaneously and proxy requests to different target endpoints with rich, color-coded console logging.

## Usage

```bash
# Install dependencies
npm i

# Start with default config.yaml
npm start

# Start with custom config file
CONFIG_FILE=myconfig.yaml npm start

# Development mode with auto-reload
npm run dev
```

## Compact vs Full

In config.yaml

```
logging:
...
  compact: true
```
