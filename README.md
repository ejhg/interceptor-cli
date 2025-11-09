# claude-code Proxy Logger

Intercept and log Anthropic API requests sent by claude-code

## Usage

```bash
# Install dependencies
npm i

# Development mode with auto-reload and file logging
npm run dev -- --log-dir logs

# Start with custom config file
CONFIG_FILE=myconfig.yaml npm run dev
```

## Compact vs Full

In config.yaml

```
logging:
...
  compact: true
```
