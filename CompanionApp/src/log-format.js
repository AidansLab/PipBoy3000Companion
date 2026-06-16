/**
 * Strip ANSI escape codes for plain-text UI display.
 */
export function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

export function formatLogEntry({ level, message, time = new Date() }) {
  const ts = time instanceof Date ? time : new Date(time);
  const stamp = ts.toLocaleTimeString();
  const plain = stripAnsi(message);
  return { level, message: plain, time: ts, line: `[${stamp}] ${plain}` };
}
