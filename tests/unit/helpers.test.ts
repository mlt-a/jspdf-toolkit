import { describe, expect, it } from 'vitest';

import { scanStream, shapesOfStream } from './content-stream';
import { filledShapes, makeDoc, sameColor } from './helpers';

/** Reads a hand-written stream on a page 100 units high, at `k` points per unit. */
const read = (lines: string[], k = 1) => shapesOfStream(lines.join('\n'), k, 100);

/** The 10x10 square every case paints, as a stream. */
const SQUARE = ['0 0 10 10 re', 'f'];

describe('shapesOfStream', () => {
  describe('fill color', () => {
    it('starts black', () => {
      expect(read(SQUARE)[0]).toMatchObject({ color: '#000000', intended: '#000000' });
    });

    it.each([
      ['rg', '1 0.5 0 rg', '#ff8000'],
      ['g', '0.5 g', '#808080'],
      ['k', '1 0 0 0 k', '#00ffff'],
      ['k with black', '0 0 0 0.5 k', '#808080'],
    ])('sets the fill with %s', (_, operator, color) => {
      expect(read([operator, ...SQUARE])).toMatchObject([{ color, intended: color }]);
    });

    it.each([['0 1 0 RG'], ['0.5 G'], ['1 0 0 0 K']])(
      'does not change the fill with the stroke operator %s',
      (operator) => {
        expect(read(['1 0 0 rg', operator, ...SQUARE])).toMatchObject([{ color: '#ff0000' }]);
      },
    );

    it('restores the fill of before a q with its Q, and keeps what the drawing code asked for', () => {
      const [inside, after] = read(['1 0 0 rg', 'q', '0 0 1 rg', ...SQUARE, 'Q', '0 0 10 10 re', 'f']);
      expect(inside).toMatchObject({ color: '#0000ff', intended: '#0000ff' });
      expect(after).toMatchObject({ color: '#ff0000', intended: '#0000ff' });
    });

    it('restores nested q and Q levels one by one', () => {
      const shapes = read(['1 0 0 rg', 'q', '0 1 0 rg', 'q', '0 0 1 rg', 'Q', ...SQUARE, 'Q', ...SQUARE]);
      expect(shapes.map((shape) => shape.color)).toEqual(['#00ff00', '#ff0000']);
    });

    it('keeps the fill on a Q without a q', () => {
      expect(read(['1 0 0 rg', 'Q', ...SQUARE])).toMatchObject([{ color: '#ff0000' }]);
    });

    it('fills the next shape with a color set in a text block, and keeps the one set outside as intended', () => {
      const [shape] = read(['1 0 0 rg', 'BT', '0 0 1 rg', '/F1 12 Tf', '(Text) Tj', 'ET', ...SQUARE]);
      expect(shape).toMatchObject({ color: '#0000ff', intended: '#ff0000' });
    });

    it('starts the intended color where the previous page ended, while the page itself starts black', () => {
      const stream = SQUARE.join('\n');
      expect(shapesOfStream(stream, 1, 100, '#ff0000')).toMatchObject([{ color: '#000000', intended: '#ff0000' }]);
    });

    it.each([['/Pattern cs'], ['/P1 scn'], ['1 0 0 sc'], ['/Sh1 sh']])('refuses the color operator %s', (operator) => {
      expect(() => read([operator, ...SQUARE])).toThrow('Unsupported color operator');
    });

    it('moves the intended color again for a color set after the text block', () => {
      const [shape] = read(['BT', '0 0 1 rg', 'ET', '0 1 0 rg', ...SQUARE]);
      expect(shape).toMatchObject({ color: '#00ff00', intended: '#00ff00' });
    });
  });

  describe('box', () => {
    it('reads a rectangle, flipped to the top left of the page', () => {
      expect(read(['10 20 30 40 re', 'f'])).toEqual([
        { x: 10, y: 40, width: 30, height: 40, color: '#000000', intended: '#000000', op: 'f' },
      ]);
    });

    it('reads a rectangle with a negative height, as jsPDF writes them', () => {
      expect(read(['10 80 30 -40 re', 'f'])).toMatchObject([{ x: 10, y: 20, width: 30, height: 40 }]);
    });

    it('divides by the points per unit', () => {
      expect(read(['20 40 60 80 re', 'f'], 2)).toMatchObject([{ x: 10, y: 40, width: 30, height: 40 }]);
    });

    it('reads a path of lines and a close', () => {
      expect(read(['10 10 m', '40 10 l', '25 30 l', 'h', 'f'])).toMatchObject([
        { x: 10, y: 70, width: 30, height: 20 },
      ]);
    });

    it('counts the control points of a curve', () => {
      expect(read(['0 0 m', '10 30 20 -5 30 0 c', 'f'])).toMatchObject([{ x: 0, y: 70, width: 30, height: 35 }]);
    });

    it('counts the control point of a v curve', () => {
      expect(read(['0 0 m', '50 40 80 0 v', 'f'])).toMatchObject([{ x: 0, y: 60, width: 80, height: 40 }]);
    });

    it('counts the control point of a y curve', () => {
      expect(read(['0 0 m', '10 40 60 0 y', 'f'])).toMatchObject([{ x: 0, y: 60, width: 60, height: 40 }]);
    });

    it('reads negative numbers', () => {
      expect(read(['-5 -5 10 10 re', 'f'])).toMatchObject([{ x: -5, y: 95, width: 10, height: 10 }]);
    });

    it('reads numbers with an exponent', () => {
      expect(read(['1e1 2E1 3e+1 4e0 re', 'f'])).toMatchObject([{ x: 10, y: 76, width: 30, height: 4 }]);
    });

    it('makes one shape of two rectangles in the same path, over their union', () => {
      expect(read(['0 0 10 10 re', '20 20 10 10 re', 'f'])).toMatchObject([{ x: 0, y: 70, width: 30, height: 30 }]);
    });

    it('starts a new path after each painting', () => {
      expect(read(['0 0 10 10 re', 'f', '50 50 5 5 re', 'f'])).toMatchObject([
        { x: 0, width: 10 },
        { x: 50, width: 5 },
      ]);
    });

    it.each(['f', 'B', 'S', 's'])('refuses the painting operator %s on an empty path', (op) => {
      expect(() => read([op])).toThrow('Painting operator on an empty path');
      expect(() => read([...SQUARE, op])).toThrow('Painting operator on an empty path');
    });

    it('lets n end an empty path', () => {
      expect(read(['n'])).toEqual([]);
    });
  });

  describe('painting operators', () => {
    it.each(['f', 'f*', 'F', 'B', 'B*', 'b', 'b*'])('paints with %s', (op) => {
      expect(read(['0 0 10 10 re', op])).toMatchObject([{ op, width: 10 }]);
    });

    it.each(['S', 's', 'n'])(
      'drops the path of %s without rendering it, and nothing of it reaches the next one',
      (op) => {
        expect(read(['0 0 10 10 re', op])).toEqual([]);
        expect(read(['0 0 10 10 re', op, '50 50 5 5 re', 'f'])).toMatchObject([{ x: 50, width: 5 }]);
      },
    );
  });
});

/** Reads the strokes of a hand-written stream, like `read`. */
const strokes = (lines: string[], k = 1) => scanStream(lines.join('\n'), k, 100).strokes;

describe('strokes of a stream', () => {
  const LINE = ['0 0 m', '10 0 l', 'S'];

  it('starts black, one unit wide, with butt caps and miter joins', () => {
    expect(strokes(LINE)).toEqual([
      { x: 0, y: 100, width: 10, height: 0, color: '#000000', lineWidth: 1, cap: 0, join: 0, op: 'S' },
    ]);
  });

  it.each([
    ['RG', '1 0.5 0 RG', { color: '#ff8000' }],
    ['G', '0.5 G', { color: '#808080' }],
    ['K', '1 0 0 0 K', { color: '#00ffff' }],
    ['w, divided by the points per unit', '3 w', { lineWidth: 1.5 }],
    ['J', '1 J', { cap: 1 }],
    ['j', '2 j', { join: 2 }],
  ])('sets the stroke with %s', (_, operator, expected) => {
    expect(strokes([operator, ...LINE], 2)).toMatchObject([expected]);
  });

  it('keeps the stroke through fill colors and text blocks', () => {
    const lines = ['1 0 0 RG', '0 0 1 rg', 'BT', '0 1 0 rg', '/F1 12 Tf', '(Text) Tj', 'ET', ...LINE];
    expect(strokes(lines)).toMatchObject([{ color: '#ff0000' }]);
  });

  it('restores the stroke of before a q with its Q', () => {
    const lines = ['1 0 0 RG', '2 w', 'q', '0 0 1 RG', '5 w', '1 J', '1 j', ...LINE, 'Q', ...LINE];
    expect(strokes(lines)).toMatchObject([
      { color: '#0000ff', lineWidth: 5, cap: 1, join: 1 },
      { color: '#ff0000', lineWidth: 2, cap: 0, join: 0 },
    ]);
  });

  it.each(['S', 's', 'B', 'B*', 'b', 'b*'])('strokes with %s, and only them', (op) => {
    expect(strokes(['0 0 10 10 re', op])).toMatchObject([{ op, width: 10 }]);
  });

  it.each(['f', 'f*', 'F', 'n'])('does not stroke with %s', (op) => {
    expect(strokes(['0 0 10 10 re', op])).toEqual([]);
  });

  it('refuses to stroke a path under a transformation', () => {
    expect(() => strokes(['q', '1 0 0 1 5 5 cm', ...LINE, 'Q'])).toThrow('under a transformation');
  });
});

/** Reads a hand-written stream that may name the graphics state `GS1`, like `read`. */
const scan = (lines: string[]) => scanStream(lines.join('\n'), 1, 100, '#000000', { GS1: { fill: 0.5 } });

describe('operators', () => {
  it.each([
    [
      'text',
      ['BT', '/F1 12 Tf', '0 1 -1 0 5 5 Tm', '10 20 Td', '1.5 Tc', '2 Tw', '14 TL', '(Text) Tj T* (Next) Tj', 'ET'],
    ],
    ['stroke', ['0.5 w', '1 J', '1 j', '[1 2] 0 d', '0 G', '0 0 0 RG', '0 0 0 0 K']],
    ['graphics state and image', ['/GS1 gs', '/I0 Do']],
    ['clip', ['0 0 10 10 re', 'W', 'n']],
    ['close', ['0 0 m', '10 0 l', 'h', 'f']],
  ])('knows the %s operators and they leave the fill alone', (_, lines) => {
    expect(scan(['1 0 0 rg', ...lines, ...SQUARE]).shapes.at(-1)).toMatchObject({ color: '#ff0000' });
  });

  it.each([['0 Tr'], ['[(a) -20 (b)] TJ'], ['100 Tz'], ['0 -14 TD'], ["(a) '"], ['10 M'], ['/X1 BDC'], ['BI']])(
    'refuses an operator it does not know, naming it: %s',
    (source) => {
      const op = source.split(' ').at(-1)!;
      expect(() => read([...SQUARE, source])).toThrow(`Unknown operator in the stream: ${source}`);
      expect(() => read([source, ...SQUARE])).toThrow(op);
    },
  );

  it.each([['1 rg'], ['/F1 Tf'], ['(a) (b) Tj'], ['[(a)] 0 d'], ['/GS1 0 gs']])(
    'refuses a known operator with operands it does not take: %s',
    (source) => {
      expect(() => read([source])).toThrow(`Malformed operator in the stream: ${source}`);
    },
  );

  it.each([
    ['an unterminated literal string', 'BT (open Tj ET', 'Unterminated string'],
    ['an unterminated hex string', 'BT <00 Tj ET', 'Unterminated string'],
    ['a dictionary', '/Span << /MCID 0 >> BDC', 'Unreadable token'],
    ['an operator inside an array', '[1 S] 0 d', 'Operator inside an array'],
    ['operands with no operator', '0 0 10 10 re 5', 'Operands with no operator'],
    ['a text operator outside a text block', '(Text) Tj', 'outside a text block'],
    ['a text matrix that scales', 'BT 14 0 0 14 5 5 Tm ET', 'scales or skews'],
    [
      'text under a transformation',
      'q 2 0 0 2 0 0 cm BT /F1 12 Tf (Text) Tj ET Q',
      'Text shown under a transformation',
    ],
    ['a clip under a transformation', 'q 2 0 0 2 0 0 cm 0 0 10 10 re W n Q', 'under a transformation'],
    ['a clip on an empty path', 'W n', 'empty path'],
    ['a graphics state it was not given', '/GS2 gs', 'Graphics state not in the document'],
  ])('refuses %s', (_, stream, error) => {
    expect(() => scan([stream])).toThrow(error);
  });

  it('reads nested and escaped parentheses as one string', () => {
    const { marks } = scan(['BT', '/F1 12 Tf', String.raw`(a (b) \\ c\) d) Tj`, 'ET']);
    expect(marks).toMatchObject([{ kind: 'text', raw: String.raw`(a (b) \\ c\) d)` }]);
  });
});

describe('graphics state', () => {
  it('composes nested transformations for an image, and restores them with Q', () => {
    const { marks } = scan([
      'q',
      '1 0 0 1 10 20 cm',
      'q',
      '30 0 0 40 0 0 cm',
      '/I0 Do',
      'Q',
      '5 0 0 5 0 0 cm',
      '/I0 Do',
      'Q',
    ]);
    expect(marks).toMatchObject([
      { kind: 'image', name: 'I0', x: 10, y: 40, width: 30, height: 40 },
      { kind: 'image', name: 'I0', x: 10, y: 75, width: 5, height: 5 },
    ]);
  });

  it('restores the opacity, the dash and the text state with Q', () => {
    const { marks } = scan([
      'q',
      '/GS1 gs',
      '[2 1] 0 d',
      'BT /F1 12 Tf 3 Tc 0 0 Td (In) Tj ET',
      '0 0 m 10 0 l S',
      'Q',
      'BT /F1 12 Tf 0 0 Td (Out) Tj ET',
      '0 0 m 10 0 l S',
    ]);
    expect(marks).toMatchObject([
      { kind: 'text', raw: '(In)', opacity: 0.5, charSpace: 3 },
      { kind: 'stroke', dash: { array: [2, 1], phase: 0 }, opacity: 1 },
      { kind: 'text', raw: '(Out)', opacity: 1, charSpace: 0 },
      { kind: 'stroke', dash: { array: [], phase: 0 } },
    ]);
  });
});

describe('transformations', () => {
  it('lets an image through under a transformation', () => {
    expect(() => read(['q', '10 0 0 10 5 5 cm', '/I0 Do', 'Q'])).not.toThrow();
  });

  it('refuses to paint a shape under a transformation', () => {
    expect(() => read(['q', '1 0 0 1 5 5 cm', '0 0 10 10 re', 'f', 'Q'])).toThrow('under a transformation');
  });

  it('refuses a path painted under a transformation of the enclosing q', () => {
    expect(() => read(['q', '1 0 0 1 5 5 cm', 'q', ...SQUARE, 'Q', 'Q'])).toThrow('under a transformation');
  });

  it('reads a shape normally after the Q that ends the transformation', () => {
    expect(read(['q', '10 0 0 10 5 5 cm', '/I0 Do', 'Q', '10 20 30 40 re', 'f'])).toMatchObject([
      { x: 10, y: 40, width: 30, height: 40 },
    ]);
  });

  it('reads a shape before the transformation', () => {
    expect(read([...SQUARE, 'q', '10 0 0 10 5 5 cm', '/I0 Do', 'Q'])).toHaveLength(1);
  });
});

describe('filledShapes', () => {
  it('carries the fill color over to the next page, which the document writes again', () => {
    const doc = makeDoc();
    doc.doc.setFillColor('#ff0000');
    doc.doc.rect(10, 10, 5, 5, 'F');
    doc.doc.addPage();
    doc.doc.rect(10, 10, 5, 5, 'F');
    expect(filledShapes(doc, 2)).toMatchObject([{ color: '#ff0000', intended: '#ff0000' }]);
  });
});

describe('sameColor', () => {
  it('tolerates the rounding of the color operators, and no more', () => {
    expect(sameColor('#3572b8', '#3572b8')).toBe(true);
    expect(sameColor('#3572b8', '#3772b6')).toBe(true);
    expect(sameColor('#3572b8', '#3872b8')).toBe(false);
  });
});
