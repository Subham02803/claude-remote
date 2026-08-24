/**
 * The slice of a logger this codebase actually uses.
 *
 * Fastify's logger and pino's are structurally almost identical but not
 * assignable to each other, so internals depend on this instead of either.
 */
export interface Log {
  debug(msg: string): void;
  debug(obj: object, msg?: string): void;
  info(msg: string): void;
  info(obj: object, msg?: string): void;
  warn(msg: string): void;
  warn(obj: object, msg?: string): void;
  error(msg: string): void;
  error(obj: object, msg?: string): void;
}
