type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SECRET_KEY_PATTERN = /key|secret|token|password|authorization/i;

function sanitize(fields: Fields): Fields {
  const result: Fields = {};
  for (const [name, value] of Object.entries(fields)) {
    if (SECRET_KEY_PATTERN.test(name) && !/tokens$/i.test(name)) {
      result[name] = "[redacted]";
    } else if (value instanceof Error) {
      result[name] = { name: value.name, message: value.message.slice(0, 300) };
    } else if (typeof value === "string") {
      result[name] = value.slice(0, 500);
    } else {
      result[name] = value;
    }
  }
  return result;
}

export type Logger = {
  child(fields: Fields): Logger;
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
};

/**
 * Structured JSON logger. Context fields (worker_id, job_id, run_id, attempt)
 * act as correlation IDs across a run's log lines. Never pass document content
 * or credentials; string values are truncated and secret-like keys redacted.
 */
export function createLogger(context: Fields = {}): Logger {
  const write = (level: Level, message: string, fields: Fields = {}) => {
    const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...sanitize(context), ...sanitize(fields) });
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };
  return {
    child: (fields) => createLogger({ ...context, ...fields }),
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

export const logger = createLogger({ service: "worker" });
