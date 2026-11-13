/** Text of a caught value, for a warning or a wrapped error: `catch` gives `unknown`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
