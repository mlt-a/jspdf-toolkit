/**
 * The entries of `value` that are not `undefined`. Spread over defaults, it keeps them where an explicit
 * `{ body: undefined }` would otherwise override them.
 */
export function defined<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
