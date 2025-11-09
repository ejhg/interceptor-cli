const chalk = require('chalk');

function formatHeaders(headers) {
  const filtered = { ...headers };
  delete filtered.host;
  return JSON.stringify(filtered, null, 2);
}

function formatBody(body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return bodyStr || '';
}

function logWithOptionalColor(text, colorFn, modelKey, isResponse = false, useColorTag = true) {
  if (useColorTag) {
    return addColorTag(text, colorFn, modelKey, isResponse);
  }
  return text;
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

module.exports = {
  formatHeaders,
  formatBody,
  logWithOptionalColor,
  addColorTag,
  formatDiff
};
