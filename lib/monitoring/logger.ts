/**
 * Structured JSON logger (master spec §63 "Observability": "Implement:
 * Application logging..." plus its explicit denylist — "Do not log:
 * Passwords / Payment secrets / Authentication tokens / Sensitive personal
 * information unnecessarily.").
 *
 * Every log line is a single JSON object on one line (`{"timestamp",
 * "level", "message", "context"}`) so a real log aggregator (CloudWatch,
 * Datadog, Grafana Loki, or just `journalctl`/`docker logs` piped through
 * `jq`) can parse it without a custom regex, and so structured fields
 * (organizationId, userId, orderId, ...) stay queryable instead of buried
 * in free text.
 *
 * `context` is recursively redacted before serialization: any object key
 * matching a known-sensitive pattern (password, secret, token,
 * authorization header, cookie, card number, bank account, government ID,
 * ...) has its value replaced with `"[REDACTED]"`, regardless of nesting
 * depth. This is a best-effort denylist, not a guarantee — callers should
 * still avoid passing raw request bodies or full user records as context;
 * pass specific, already-known-safe fields instead. See
 * `tests/unit/logger.test.ts` for the exact key patterns this covers.
 *
 * This module is now the ONE place in the codebase allowed to call
 * `console.*` directly — every other call site (`lib/utils/api-error.ts`'s
 * catch-all, `NotificationService`'s dispatch failures,
 * `InventoryService.consumeForOrder`'s unit-conversion guard, ...) goes
 * through `log.*` instead, so log shape stays consistent everywhere.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const REDACTED = '[REDACTED]';

// Matches the field name, not the value — deliberately broad (better to
// over-redact an innocuous "tokenCount" field than under-redact a real
// secret). Covers §63's explicit list plus the other identifiers this
// codebase's own privacy rules (see prisma/schema.prisma, CLAUDE.md) treat
// as sensitive: government IDs, card/bank numbers.
const SENSITIVE_KEY_PATTERN =
  /password|passwd|pwd|secret|token|authorization|auth[-_]?header|cookie|session[-_]?id|ssn|social[-_]?security|(?:card|pan)[-_]?number|\bcvv\b|\bcvc\b|bank[-_]?account|routing[-_]?number|api[-_]?key/i;

/**
 * Recursively walks a value, replacing any object property whose key
 * matches `SENSITIVE_KEY_PATTERN` with `"[REDACTED]"`. Handles arrays and
 * circular references (a circular reference becomes `"[CIRCULAR]"` rather
 * than throwing or hanging). Exported so tests can verify redaction in
 * isolation from log emission.
 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, seen);
  }
  return out;
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context !== undefined ? { context: redact(context) } : {}),
  };
  const line = JSON.stringify(entry);
  // eslint-disable-next-line no-console -- this is the one sanctioned console call site (see file header).
  if (level === 'error') console.error(line);
  // eslint-disable-next-line no-console
  else if (level === 'warn') console.warn(line);
  // eslint-disable-next-line no-console
  else console.log(line);
}

export const log = {
  debug(message: string, context?: Record<string, unknown>): void {
    emit('debug', message, context);
  },
  info(message: string, context?: Record<string, unknown>): void {
    emit('info', message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    emit('warn', message, context);
  },
  /** `error` may be any thrown value; it's serialized via `serializeError` and merged into context as `context.error`. */
  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    emit('error', message, {
      ...(context ?? {}),
      ...(error !== undefined ? { error: serializeError(error) } : {}),
    });
  },
};
