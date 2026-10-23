// ============================================================
// utils/logger.js - Logger simple con niveles y colores
// ============================================================
'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const COLORS = {
  error: '\x1b[31m', // Rojo
  warn:  '\x1b[33m', // Amarillo
  info:  '\x1b[36m', // Cian
  debug: '\x1b[90m', // Gris
  reset: '\x1b[0m',
};

const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, ...args) {
  if (LEVELS[level] > currentLevel) return;
  const ts = new Date().toISOString();
  const color = COLORS[level] || '';
  const label = level.toUpperCase().padEnd(5);
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](
    `${color}[${ts}] [${label}]${COLORS.reset}`,
    ...args
  );
}

const logger = {
  error: (...args) => log('error', ...args),
  warn:  (...args) => log('warn',  ...args),
  info:  (...args) => log('info',  ...args),
  debug: (...args) => log('debug', ...args),
};

module.exports = logger;
