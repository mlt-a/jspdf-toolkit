import { describe, expect, it } from 'vitest';

import { defined } from '../../src/utils/defined';

describe('defined', () => {
  it('drops the entries left undefined and keeps the others, falsy ones included', () => {
    expect(defined({ a: 1, b: undefined, c: 0, d: '', e: null, f: false })).toEqual({
      a: 1,
      c: 0,
      d: '',
      e: null,
      f: false,
    });
  });

  it('gives an empty object for nothing', () => {
    expect(defined(undefined)).toEqual({});
    expect(defined({})).toEqual({});
  });

  it('lets defaults show through a spread', () => {
    expect({ height: 15, ...defined({ height: undefined, x: 4 }) }).toEqual({ height: 15, x: 4 });
  });

  it('does not write to its argument', () => {
    const value = { a: undefined, b: 1 };
    defined(value);
    expect(value).toEqual({ a: undefined, b: 1 });
  });
});
