// Reads a page content stream as a PDF viewer does: the operators with their operands, and the graphics and text
// state they set. What it does not know how to read throws: an operator it skipped could paint something it never saw.

export type FilledShape = {
  /** Bounding box (mm, from the top left of the page). Curves count with their control points. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The color the shape is really filled with, #rrggbb: the fill color of the graphics state when it is painted. */
  color: string;
  /**
   * The color the drawing code asked for: the last fill color set outside a text block, the one `getFillColor` reads
   * back. It differs from `color` when text was written since, or when a `q`/`Q` pair undid it.
   */
  intended: string;
  /** The painting operator: `f`, `f*`, `F`, `B`, `B*`, `b` or `b*`. */
  op: string;
};

export type StrokedShape = {
  /** Bounding box (mm, from the top left of the page). Curves count with their control points. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The color the shape is really stroked with, #rrggbb. */
  color: string;
  /** Line width (mm) in force when the shape is stroked. */
  lineWidth: number;
  /** Line cap and join in force, as PDF numbers: 0 butt and miter, 1 round, 2 square and bevel. */
  cap: number;
  join: number;
  /** The painting operator: `S`, `s`, `B`, `B*`, `b` or `b*`. */
  op: string;
};

/** A string a content stream shows, as the stream holds it: `raw` is a hex string of glyph ids or a literal string. */
export type StreamText = {
  /** Where the string starts: x, and the baseline (mm, from the top left of the page). */
  x: number;
  y: number;
  /** Font size (pt), as set by `Tf`. */
  size: number;
  /** The font resource, e.g. `F15`. */
  font: string;
  /** The color the string is really filled with, #rrggbb. */
  color: string;
  /** Letter spacing (mm), 0 when none. */
  charSpace: number;
  /** Word spacing (mm) added to each space, set by `Tw` for a justified line; 0 when none. */
  wordSpace: number;
  /** Rotation (degrees, counter-clockwise) of the text matrix, 0 when none. */
  angle: number;
  raw: string;
};

/** An image painted by `Do`: the box (mm, from the top left of the page) its transformation maps the unit square to. */
export type StreamImage = { x: number; y: number; width: number; height: number; name: string };

/** A clipping path set by `W` or `W*`: its box (mm, from the top left of the page). */
export type StreamClip = { x: number; y: number; width: number; height: number; op: string };

/** A dash pattern set by `d` (mm): empty for a solid line. */
export type Dash = { array: number[]; phase: number };

/** What a page paints, in the order its content stream does, with the opacity it is painted at. */
export type PageMark = { opacity: number } & (
  | ({ kind: 'text' } & StreamText)
  | ({ kind: 'fill' } & FilledShape)
  | ({ kind: 'stroke'; dash: Dash } & StrokedShape)
  | ({ kind: 'image' } & StreamImage)
  | ({ kind: 'clip' } & StreamClip)
);

/** The opacities an extended graphics state (`gs`) sets: `fill` for fills, text and images, `stroke` for strokes. */
export type GraphicsStateOpacity = { fill?: number; stroke?: number };

/** An operand: a number, a name (`/F1`), a string as written (`(…)` or `<…>`), or an array. */
type Operand =
  | { kind: 'number'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'string'; raw: string }
  | { kind: 'array'; items: Operand[] };

/** An operator, its operands, and the text of the stream they were read from. */
type Operation = { op: string; operands: Operand[]; source: string };

const REGULAR = /[^\s()<>[\]{}/%]+/y;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** The end (exclusive) of the literal string opening at `start`: parentheses nest, a backslash escapes. */
function literalEnd(stream: string, start: number): number {
  let depth = 0;
  for (let at = start; at < stream.length; at++) {
    const char = stream[at];
    if (char === '\\') at++;
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return at + 1;
  }
  throw new Error(`Unterminated string in the stream: ${stream.slice(start, start + 40)}`);
}

/** Splits a content stream into its operations. Dictionaries and inline images are not read: they throw. */
function parseOperations(stream: string): Operation[] {
  const operations: Operation[] = [];
  let operands: Operand[] = [];
  const arrays: Operand[][] = [];
  // Where the operands of the coming operator start.
  let start = -1;
  const push = (operand: Operand) => (arrays.at(-1) ?? operands).push(operand);
  let at = 0;
  while (at < stream.length) {
    const char = stream[at];
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    if (start < 0) start = at;
    if (char === '(') {
      const end = literalEnd(stream, at);
      push({ kind: 'string', raw: stream.slice(at, end) });
      at = end;
    } else if (char === '<' && stream[at + 1] !== '<') {
      const end = stream.indexOf('>', at);
      if (end < 0) throw new Error(`Unterminated string in the stream: ${stream.slice(at, at + 40)}`);
      push({ kind: 'string', raw: stream.slice(at, end + 1) });
      at = end + 1;
    } else if (char === '[') {
      arrays.push([]);
      at++;
    } else if (char === ']' && arrays.length > 0) {
      push({ kind: 'array', items: arrays.pop()! });
      at++;
    } else if (char === '/') {
      REGULAR.lastIndex = at + 1;
      const name = REGULAR.exec(stream)?.[0] ?? '';
      push({ kind: 'name', value: name });
      at += 1 + name.length;
    } else {
      REGULAR.lastIndex = at;
      const token = REGULAR.exec(stream)?.[0];
      if (token === undefined) throw new Error(`Unreadable token in the stream: ${stream.slice(at, at + 40)}`);
      at += token.length;
      if (NUMBER.test(token)) {
        push({ kind: 'number', value: Number(token) });
        continue;
      }
      if (arrays.length > 0) throw new Error(`Operator inside an array in the stream: ${stream.slice(start, at)}`);
      operations.push({ op: token, operands, source: stream.slice(start, at) });
      operands = [];
      start = -1;
    }
  }
  if (start >= 0) throw new Error(`Operands with no operator at the end of the stream: ${stream.slice(start)}`);
  return operations;
}

/**
 * The operators the reader follows, with the kinds of their operands: `n` a number, `/` a name, `s` a string, `a` an
 * array of numbers. Any other operator throws.
 */
const SIGNATURES: Record<string, string> = {
  q: '',
  Q: '',
  cm: 'nnnnnn',
  w: 'n',
  J: 'n',
  j: 'n',
  d: 'an',
  gs: '/',
  g: 'n',
  rg: 'nnn',
  k: 'nnnn',
  G: 'n',
  RG: 'nnn',
  K: 'nnnn',
  m: 'nn',
  l: 'nn',
  c: 'nnnnnn',
  v: 'nnnn',
  y: 'nnnn',
  re: 'nnnn',
  h: '',
  f: '',
  'f*': '',
  F: '',
  B: '',
  'B*': '',
  b: '',
  'b*': '',
  S: '',
  s: '',
  n: '',
  W: '',
  'W*': '',
  BT: '',
  ET: '',
  Tf: '/n',
  TL: 'n',
  Tc: 'n',
  Tw: 'n',
  Td: 'nn',
  Tm: 'nnnnnn',
  'T*': '',
  Tj: 's',
  Do: '/',
};

const OPERAND_KINDS: Record<string, Operand['kind']> = { n: 'number', '/': 'name', s: 'string', a: 'array' };

/** Color operators whose effect on the fill the reader does not follow: reading past them could hide a wrong fill. */
const UNREAD_COLOR_OPERATORS = new Set(['sc', 'scn', 'cs', 'sh']);

/** The operators that paint a path: they throw on an empty one. */
const FILL_OPERATORS = new Set(['f', 'f*', 'F', 'B', 'B*', 'b', 'b*']);
const STROKE_OPERATORS = new Set(['S', 's']);
/** The operators that stroke a path: `B` and `b` fill it and stroke it. */
const STROKED_OPERATORS = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);

/** The operands of `operation`, checked against its signature: numbers, names, strings or arrays of numbers. */
function checkedOperands({ op, operands, source }: Operation): Operand[] {
  if (UNREAD_COLOR_OPERATORS.has(op)) throw new Error(`Unsupported color operator in the stream: ${source}`);
  const signature = SIGNATURES[op];
  if (signature === undefined) throw new Error(`Unknown operator in the stream: ${source}`);
  const fits =
    operands.length === signature.length &&
    operands.every(
      (operand, index) =>
        operand.kind === OPERAND_KINDS[signature[index]] &&
        (operand.kind !== 'array' || operand.items.every((item) => item.kind === 'number')),
    );
  if (!fits) throw new Error(`Malformed operator in the stream: ${source}`);
  return operands;
}

const number = (operand: Operand) => (operand as { value: number }).value;
const name = (operand: Operand) => (operand as { value: string }).value;

const toHex = (levels: number[]) =>
  `#${levels
    .map((level) =>
      Math.round(level * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

const cmykToHex = ([c, m, y, black]: number[]) =>
  toHex([(1 - c) * (1 - black), (1 - m) * (1 - black), (1 - y) * (1 - black)]);

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `first` then `second`, as PDF concatenates matrices: a point goes through `first`, then through `second`. */
const multiply = ([a, b, c, d, e, f]: Matrix, [a2, b2, c2, d2, e2, f2]: Matrix): Matrix => [
  a * a2 + b * c2,
  a * b2 + b * d2,
  c * a2 + d * c2,
  c * b2 + d * d2,
  e * a2 + f * c2 + e2,
  e * b2 + f * d2 + f2,
];

const isIdentity = (matrix: Matrix) => matrix.every((value, index) => value === IDENTITY[index]);

/** Whether `matrix` only rotates and moves: a scaled or skewed text matrix changes the size the text is read at. */
const isRotation = ([a, b, c, d]: Matrix) =>
  Math.abs(a * a + b * b - 1) < 1e-6 && Math.abs(a - d) < 1e-6 && Math.abs(b + c) < 1e-6;

/** The graphics state a `q` saves and a `Q` restores, text state included. */
type GraphicsState = {
  fill: string;
  stroke: { color: string; width: number; cap: number; join: number };
  dash: Dash;
  opacity: { fill: number; stroke: number };
  /** The current transformation matrix. */
  ctm: Matrix;
  text: { font: string; size: number; leading: number; charSpace: number; wordSpace: number };
};

/**
 * Reads a content stream: `k` points per unit, the page height in those units, the fill color the drawing code had
 * asked for at its start, and the opacities of the extended graphics states it may name.
 */
export function scanStream(
  stream: string,
  k: number,
  pageHeight: number,
  intendedAtStart = '#000000',
  graphicsStates: Record<string, GraphicsStateOpacity> = {},
) {
  const shapes: FilledShape[] = [];
  const strokes: StrokedShape[] = [];
  const marks: PageMark[] = [];
  // The state of the page: black, 1 unit wide, butt cap and miter join, solid, opaque, untransformed.
  let state: GraphicsState = {
    fill: '#000000',
    stroke: { color: '#000000', width: 1, cap: 0, join: 0 },
    dash: { array: [], phase: 0 },
    opacity: { fill: 1, stroke: 1 },
    ctm: IDENTITY,
    text: { font: '', size: 0, leading: 0, charSpace: 0, wordSpace: 0 },
  };
  const saved: GraphicsState[] = [];
  let intended = intendedAtStart;
  // The text line matrix: `BT` resets it, `Td`, `T*` and `Tm` move it. `null` outside a text block.
  let line: Matrix | null = null;
  let points: Array<[number, number]> = [];
  // The clipping operator waiting for the painting operator that ends its path.
  let clip: string | null = null;
  const box = () => {
    const xs = points.map(([x]) => x / k);
    const ys = points.map(([, y]) => pageHeight - y / k);
    const [left, top] = [Math.min(...xs), Math.min(...ys)];
    return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  };
  // Only the color operators move the intended color, and only outside a text block.
  const setFill = (color: string) => {
    state.fill = color;
    if (line === null) intended = color;
  };
  const moveLine = (tx: number, ty: number, source: string) => {
    if (line === null) throw new Error(`Text operator outside a text block: ${source}`);
    const [a, b, c, d, e, f] = line;
    line = [a, b, c, d, e + tx * a + ty * c, f + tx * b + ty * d];
  };

  for (const operation of parseOperations(stream)) {
    const { op, source } = operation;
    const operands = checkedOperands(operation);
    const nums = operands.map(number);
    const paints = FILL_OPERATORS.has(op) || STROKE_OPERATORS.has(op);
    // A clip takes effect at the operator that ends its path, painting or not (`n`).
    const clips = clip !== null && (paints || op === 'n');
    if ((paints || clips) && points.length === 0) throw new Error(`Painting operator on an empty path: ${source}`);
    if ((paints || clips) && !isIdentity(state.ctm)) {
      throw new Error(`Shape painted under a transformation (cm), which the reader does not follow: ${source}`);
    }
    let stroked: (StrokedShape & { dash: Dash }) | undefined;
    if (STROKED_OPERATORS.has(op)) {
      const { color, width, cap, join } = state.stroke;
      const shape = { ...box(), color, lineWidth: width / k, cap, join, op };
      strokes.push(shape);
      stroked = { ...shape, dash: state.dash };
    }
    if (clips) {
      marks.push({ kind: 'clip', ...box(), op: clip!, opacity: 1 });
      clip = null;
    }
    switch (op) {
      case 'BT':
        line = IDENTITY;
        break;
      case 'ET':
        line = null;
        break;
      case 'q':
        saved.push(structuredClone(state));
        break;
      case 'Q':
        state = saved.pop() ?? state;
        break;
      case 'cm':
        state.ctm = multiply(nums as Matrix, state.ctm);
        break;
      case 'gs': {
        const opacity = graphicsStates[name(operands[0])];
        if (opacity === undefined) throw new Error(`Graphics state not in the document: ${source}`);
        state.opacity = { fill: opacity.fill ?? state.opacity.fill, stroke: opacity.stroke ?? state.opacity.stroke };
        break;
      }
      case 'd':
        state.dash = {
          array: (operands[0] as { items: Operand[] }).items.map((item) => number(item) / k),
          phase: nums[1] / k,
        };
        break;
      case 'Do': {
        const [a, b, c, d, e, f] = state.ctm;
        const xs = [e, e + a, e + c, e + a + c];
        const ys = [f, f + b, f + d, f + b + d];
        const [left, top] = [Math.min(...xs) / k, pageHeight - Math.max(...ys) / k];
        marks.push({
          kind: 'image',
          x: left,
          y: top,
          width: Math.max(...xs) / k - left,
          height: pageHeight - Math.min(...ys) / k - top,
          name: name(operands[0]),
          opacity: state.opacity.fill,
        });
        break;
      }
      case 'Tf':
        state.text.font = name(operands[0]);
        state.text.size = nums[1];
        break;
      case 'TL':
        state.text.leading = nums[0];
        break;
      case 'Tc':
        state.text.charSpace = nums[0];
        break;
      case 'Tw':
        state.text.wordSpace = nums[0];
        break;
      case 'Td':
        moveLine(nums[0], nums[1], source);
        break;
      case 'T*':
        moveLine(0, -state.text.leading, source);
        break;
      case 'Tm':
        if (line === null) throw new Error(`Text operator outside a text block: ${source}`);
        if (!isRotation(nums as Matrix)) throw new Error(`Text matrix that scales or skews: ${source}`);
        line = nums as Matrix;
        break;
      case 'Tj': {
        if (line === null) throw new Error(`Text operator outside a text block: ${source}`);
        if (!isIdentity(state.ctm)) {
          throw new Error(`Text shown under a transformation (cm), which the reader does not follow: ${source}`);
        }
        const [a, b, , , e, f] = line;
        const { font, size, charSpace, wordSpace } = state.text;
        marks.push({
          kind: 'text',
          x: e / k,
          y: pageHeight - f / k,
          size,
          font,
          color: state.fill,
          charSpace: charSpace / k,
          wordSpace: wordSpace / k,
          angle: (Math.atan2(b, a) * 180) / Math.PI,
          raw: (operands[0] as { raw: string }).raw,
          opacity: state.opacity.fill,
        });
        break;
      }
      case 'g':
        setFill(toHex([nums[0], nums[0], nums[0]]));
        break;
      case 'rg':
        setFill(toHex(nums));
        break;
      case 'k':
        setFill(cmykToHex(nums));
        break;
      case 'G':
        state.stroke = { ...state.stroke, color: toHex([nums[0], nums[0], nums[0]]) };
        break;
      case 'RG':
        state.stroke = { ...state.stroke, color: toHex(nums) };
        break;
      case 'K':
        state.stroke = { ...state.stroke, color: cmykToHex(nums) };
        break;
      case 'w':
        state.stroke = { ...state.stroke, width: nums[0] };
        break;
      case 'J':
        state.stroke = { ...state.stroke, cap: nums[0] };
        break;
      case 'j':
        state.stroke = { ...state.stroke, join: nums[0] };
        break;
      case 're':
        points.push([nums[0], nums[1]], [nums[0] + nums[2], nums[1] + nums[3]]);
        break;
      case 'm':
      case 'l':
        points.push([nums[0], nums[1]]);
        break;
      case 'c':
        points.push([nums[0], nums[1]], [nums[2], nums[3]], [nums[4], nums[5]]);
        break;
      // Curves that leave one control point implicit (the current point, or the end point).
      case 'v':
      case 'y':
        points.push([nums[0], nums[1]], [nums[2], nums[3]]);
        break;
      case 'W':
      case 'W*':
        clip = op;
        break;
      case 'f':
      case 'f*':
      case 'F':
      case 'B':
      case 'B*':
      case 'b':
      case 'b*': {
        const filled = { ...box(), color: state.fill, intended, op };
        shapes.push(filled);
        marks.push({ kind: 'fill', ...filled, opacity: state.opacity.fill });
        points = [];
        break;
      }
      case 'S':
      case 's':
      case 'n':
        points = [];
        break;
      // `h` closes the subpath: it adds no point.
    }
    // A path both filled and stroked is painted in that order.
    if (stroked !== undefined) marks.push({ kind: 'stroke', ...stroked, opacity: state.opacity.stroke });
  }
  return { shapes, strokes, marks, intended };
}

/** `filledShapes` on a content stream: `k` points per unit, and the page height in those units. */
export function shapesOfStream(stream: string, k: number, pageHeight: number, intendedAtStart = '#000000') {
  return scanStream(stream, k, pageHeight, intendedAtStart).shapes;
}
