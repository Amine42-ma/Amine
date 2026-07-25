const COLORS = { info: '\x1b[36m', ok: '\x1b[32m', warn: '\x1b[33m', err: '\x1b[31m', dim: '\x1b[90m' };
const RESET = '\x1b[0m';

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  info: (...a) => console.log(`${COLORS.dim}${stamp()}${RESET} ${COLORS.info}▸${RESET}`, ...a),
  ok: (...a) => console.log(`${COLORS.dim}${stamp()}${RESET} ${COLORS.ok}✓${RESET}`, ...a),
  warn: (...a) => console.warn(`${COLORS.dim}${stamp()}${RESET} ${COLORS.warn}!${RESET}`, ...a),
  err: (...a) => console.error(`${COLORS.dim}${stamp()}${RESET} ${COLORS.err}✗${RESET}`, ...a),
};
