/** Base of every error the library throws: `catch (e) { if (e instanceof PdfToolkitError) … }`. */
export class PdfToolkitError extends Error {
  /** Sets `name` to the name of the concrete error class. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A malformed color; `token` names the palette entry or the theme setting when the color came from one. */
export class InvalidColorError extends PdfToolkitError {
  /** `value` is the rejected input; `token` names the palette entry it came from, if any. */
  constructor(
    /** The rejected input. */
    readonly value: unknown,
    /** Palette entry or theme setting (`theme.typography.levels.h2.color`) the color came from, when known. */
    readonly token?: string,
  ) {
    super(
      `Invalid color "${value}"${token === undefined ? '' : ` for token "${token}"`}: ` +
        'expected a palette token or a #RGB/#RRGGBB hex color',
    );
  }
}

/** An invalid configuration or argument: a document option, a cover variant, a theme font family. */
export class InvalidOptionError extends PdfToolkitError {}

/** An image or font file that cannot be read or decoded. */
export class AssetLoadError extends PdfToolkitError {}

/** What an error names: the text, or a function that writes it, so the work is done only on failure. */
type Name = string | (() => string);

const nameOf = (what: Name): string => (typeof what === 'function' ? what() : what);

/** How a rejected `value` reads in a message: a container or a function is named, not printed (it may not print). */
export function describe(value: unknown): string {
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'object' && value !== null) return 'an object';
  return String(value);
}

/** Bounds a number option keeps to. `checkedNumber` names them in its error. */
export interface NumberBounds {
  /** Smallest value allowed. */
  min?: number;
  /** The value must be greater than this one. */
  exclusiveMin?: number;
  /** Largest value allowed. */
  max?: number;
  /** The value must be less than this one. */
  exclusiveMax?: number;
  /** Whole numbers only. */
  integer?: boolean;
  /** What else the option takes, named in the error, e.g. `"'auto'"`. */
  or?: string;
}

/** The bounds of a length, a size or a scale: a finite number above 0. */
export const POSITIVE: NumberBounds = { exclusiveMin: 0 };

/**
 * `value` when it is a finite number within `bounds`, else an `InvalidOptionError` that names `what` and the bounds.
 * The error is built only on failure: callers check widths on every measuring pass. `what` may be a function for the
 * same reason: a name with the values in it is then written only when it is needed.
 */
export function checkedNumber(what: Name, value: unknown, bounds: NumberBounds = {}): number {
  if (typeof value === 'number' && isWithin(value, bounds)) return value;
  throw new InvalidOptionError(`Invalid ${nameOf(what)}: ${describe(value)} — must be ${describeBounds(bounds)}`);
}

/** `checkedNumber` for an optional number: `undefined` passes. */
export function optionalNumber(what: Name, value: unknown, bounds: NumberBounds = {}): number | undefined {
  return value === undefined ? undefined : checkedNumber(what, value, bounds);
}

function isWithin(value: number, { min, exclusiveMin, max, exclusiveMax, integer }: NumberBounds): boolean {
  return (
    Number.isFinite(value) &&
    (!integer || Number.isInteger(value)) &&
    (min === undefined || value >= min) &&
    (exclusiveMin === undefined || value > exclusiveMin) &&
    (max === undefined || value <= max) &&
    (exclusiveMax === undefined || value < exclusiveMax)
  );
}

function describeBounds({ min, exclusiveMin, max, exclusiveMax, integer, or }: NumberBounds): string {
  const limits = [
    exclusiveMin === undefined ? undefined : `greater than ${exclusiveMin}`,
    min === undefined ? undefined : `at least ${min}`,
    exclusiveMax === undefined ? undefined : `less than ${exclusiveMax}`,
    max === undefined ? undefined : `at most ${max}`,
  ].filter((limit) => limit !== undefined);
  const kind = integer ? 'a whole number' : 'a finite number';
  return `${kind}${limits.length > 0 ? `, ${limits.join(' and ')}` : ''}${or === undefined ? '' : ` or ${or}`}`;
}

/** Position and size (mm) of what a primitive draws. */
export interface Geometry {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

type GeometryKey = keyof Geometry;

const ALL_GEOMETRY: readonly GeometryKey[] = ['x', 'y', 'width', 'height'];

/**
 * The `x`, `y`, `width` and `height` of `geometry`, checked: a coordinate is a finite number, a size a finite number
 * above 0. The keys in `required` must be set; the others may be left out. The error names `<what> <key> (mm)`.
 */
export function checkedBox<K extends GeometryKey = GeometryKey>(
  what: string,
  geometry: Geometry,
  required: readonly K[] = ALL_GEOMETRY as readonly K[],
): Geometry & Required<Pick<Geometry, K>> {
  checkedObject(what, geometry);
  const checked: Geometry = {};
  for (const key of ALL_GEOMETRY) {
    const value = geometry[key];
    if (value === undefined && !(required as readonly GeometryKey[]).includes(key)) continue;
    const bounds = key === 'width' || key === 'height' ? POSITIVE : {};
    checked[key] = checkedNumber(`${what} ${key} (mm)`, value, bounds);
  }
  return checked as Geometry & Required<Pick<Geometry, K>>;
}

/** `checkedBox` for a point: `x` and `y`, both required. */
export function checkedPoint(what: string, point: { x: number; y: number }): { x: number; y: number } {
  return checkedBox(what, point, ['x', 'y']);
}

/** `value` when it is a string, else an `InvalidOptionError` that names `what`. */
export function checkedText(what: Name, value: unknown): string {
  if (typeof value === 'string') return value;
  throw new InvalidOptionError(`Invalid ${nameOf(what)}: ${describe(value)} — must be a string`);
}

/** `value` when it is a boolean, else an `InvalidOptionError` that names `what`. */
export function checkedBoolean(what: Name, value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  throw new InvalidOptionError(`Invalid ${nameOf(what)}: ${describe(value)} — must be true or false`);
}

/** `checkedBoolean` for an optional flag: `undefined` passes. */
export function optionalBoolean(what: Name, value: unknown): boolean | undefined {
  return value === undefined ? undefined : checkedBoolean(what, value);
}

/** `checkedText` for an optional text: `undefined` passes. */
export function optionalText(what: Name, value: unknown): string | undefined {
  return value === undefined ? undefined : checkedText(what, value);
}

/** `values` when it is an array of strings, else an `InvalidOptionError` that names `what` and the index of the entry. */
export function checkedTexts(what: string, values: readonly string[]): readonly string[] {
  checkedArray(what, values).forEach((value, index) => checkedText(() => `${what}[${index}]`, value));
  return values;
}

/** `value` when it is an array, else an `InvalidOptionError` that names `what`. */
export function checkedArray<A extends readonly unknown[]>(what: Name, value: A): A {
  if (Array.isArray(value)) return value;
  throw new InvalidOptionError(`Invalid ${nameOf(what)}: ${describe(value)} — must be an array`);
}

/**
 * `value` when it is an object (not `null`, not an array), else an `InvalidOptionError` that names `what`. `or` names
 * what else the value may be, e.g. `'a string'`.
 */
export function checkedObject<T extends object>(what: Name, value: T, or?: string): T {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
  throw new InvalidOptionError(
    `Invalid ${nameOf(what)}: ${describe(value)} — must be an object${or === undefined ? '' : ` or ${or}`}`,
  );
}

/** `value` when it is a function, else an `InvalidOptionError` that names `what`. */
export function checkedFunction<F extends (...args: never[]) => unknown>(what: Name, value: F): F {
  if (typeof value === 'function') return value;
  throw new InvalidOptionError(`Invalid ${nameOf(what)}: ${describe(value)} — must be a function`);
}

/** `checkedFunction` for an optional callback: `undefined` passes. */
export function optionalFunction<F extends (...args: never[]) => unknown>(
  what: Name,
  value: F | undefined,
): F | undefined {
  return value === undefined ? undefined : checkedFunction(what, value);
}

/**
 * `items` when it is an array of objects, else an `InvalidOptionError` that names `what` and the index of the item
 * that is none. `each` then checks the fields of every item, before anything is drawn.
 */
export function checkedObjects<T extends object>(
  what: string,
  items: readonly T[],
  each?: (item: T, index: number) => void,
): readonly T[] {
  checkedArray(what, items);
  items.forEach((item, index) => {
    checkedObject(() => `${what}[${index}]`, item);
    each?.(item, index);
  });
  return items;
}

/** `value` when it is one of `available`, else the `InvalidOptionError` of `unknownOption`. */
export function checkedChoice<C extends string>(what: Name, value: unknown, available: readonly C[]): C {
  if (available.includes(value as C)) return value as C;
  throw unknownOption(nameOf(what), value, available);
}

/** `checkedChoice` for an optional choice: `undefined` passes. */
export function optionalChoice<C extends string>(what: Name, value: unknown, available: readonly C[]): C | undefined {
  return value === undefined ? undefined : checkedChoice(what, value, available);
}

/**
 * Throws an `InvalidOptionError` when `options` sets one of `keys`: the options of another variant of `what`, which
 * the types forbid and which would be ignored without a word.
 */
export function checkedLeftOut(what: string, options: object, keys: readonly string[]): void {
  for (const key of keys) {
    const value = (options as Record<string, unknown>)[key];
    if (value !== undefined) {
      throw new InvalidOptionError(
        `Invalid ${what} ${key}: ${describe(value)} — must be left out, it is not an option of this variant`,
      );
    }
  }
}

/** The error for an option `value` outside `available`, which the message lists. */
export function unknownOption(what: string, value: unknown, available: readonly string[]): InvalidOptionError {
  const list = available.length > 0 ? available.map((name) => `'${name}'`).join(', ') : 'none';
  return new InvalidOptionError(`Unknown ${what} "${String(value)}" (available: ${list})`);
}
