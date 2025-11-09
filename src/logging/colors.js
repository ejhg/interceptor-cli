const chalk = require('chalk');

const colorRotation = [
  chalk.cyan,
  chalk.green,
  chalk.yellow,
  chalk.magenta,
  chalk.blue,
  chalk.redBright,
  chalk.greenBright,
  chalk.yellowBright,
  chalk.cyanBright,
  chalk.magentaBright
];

let colorIndex = 0;

function getNextColor() {
  const color = colorRotation[colorIndex];
  colorIndex = (colorIndex + 1) % colorRotation.length;
  return color;
}

module.exports = { getNextColor };
