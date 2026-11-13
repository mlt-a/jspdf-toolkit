import { BOX, lineHeightMm } from '../core/constants';
import type { TextLevel } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { checkedChoice, checkedObject, checkedObjects, checkedText, optionalBoolean } from '../core/errors';
import type { BoxStylePreset } from './boxes';
import { drawBox, optionalBoxStyle } from './boxes';
import { withDrawingState } from './drawing-state';
import { measureTextLevel, setTextStyle, textLevelSize } from './text';
import { text as drawText, remainingTextWidth, wrap } from './text-lines';

/** One line of an address block. */
export interface AddressLine {
  /** The line as drawn; a line wider than the box wraps. */
  text: string;
  /**
   * What the line is, which sets its text level: `title` in `label`, `subtitle` in `smallMuted`, `address` in `body`.
   */
  role: 'title' | 'subtitle' | 'address';
}

/** Options of `addressBlock`. */
export interface AddressBlockOptions {
  /** Fill and border preset. Default: `'surfaceBorder'`. */
  boxStyle?: BoxStylePreset;
  /** Space (mm) under the box. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}

const ROLE_LEVEL = { title: 'label', subtitle: 'smallMuted', address: 'body' } as const satisfies Record<
  AddressLine['role'],
  TextLevel
>;

const ROLES = Object.keys(ROLE_LEVEL) as AddressLine['role'][];

/** The options checked and defaulted, before the lines are looked at. */
interface AddressFrame {
  textWidth: number;
  spaceAfter: number;
}

function addressFrame(ctx: DrawingContext, options?: AddressBlockOptions): AddressFrame {
  checkedObject('addressBlock options', options ?? {});
  optionalBoxStyle('addressBlock', options?.boxStyle);
  return {
    textWidth: remainingTextWidth('addressBlock', ctx.measure, BOX.padding * 2),
    spaceAfter: ctx.resolveSpaceAfter(options?.spaceAfter),
  };
}

/** Every line checked before anything is drawn: its `text` and its `role`. */
function checkLines(lines: AddressLine[]): void {
  checkedObjects('addressBlock lines', lines, (line, index) => {
    checkedText(() => `addressBlock lines[${index}] text`, line.text);
    checkedChoice(() => `addressBlock lines[${index}] role`, line.role, ROLES);
  });
}

interface AddressLayout {
  /** One entry per drawn line: long address lines wrap within the box. */
  lines: Array<{ text: string; level: TextLevel }>;
  /** Total box height, shared by measuring and drawing. */
  height: number;
}

/** Single source of layout for drawing and measuring the block. The caller holds the scope. */
function layoutAddressBlock(ctx: DrawingContext, lines: AddressLine[], textWidth: number): AddressLayout {
  const body = measureTextLevel(ctx, 'body');
  const wrapped = lines.flatMap((line) => {
    const level = ROLE_LEVEL[line.role];
    setTextStyle(ctx, level);
    return wrap(ctx, line.text, textWidth).map((text) => ({ text, level }));
  });
  // The last line only needs its own glyph height, not the leading that follows it.
  const lastLineHeight = lineHeightMm(textLevelSize(ctx, 'body'), 1);
  const linesHeight = (wrapped.length - 1) * body.lineHeight + lastLineHeight;
  return { lines: wrapped, height: BOX.padding * 2 + linesHeight };
}

export function drawAddressBlock(ctx: DrawingContext, lines: AddressLine[], options?: AddressBlockOptions): number {
  const { textWidth, spaceAfter } = addressFrame(ctx, options);
  checkLines(lines);
  if (lines.length === 0) return ctx.peekYPos();
  return withDrawingState(ctx, () => {
    const body = measureTextLevel(ctx, 'body');
    const boxStyle = options?.boxStyle ?? 'surfaceBorder';

    const layout = layoutAddressBlock(ctx, lines, textWidth);
    const { height } = layout;
    ctx.ensureSpace(height + spaceAfter);
    const currentY = ctx.getYPos();
    const x = ctx.margins.left;

    drawBox(ctx, {
      x,
      y: currentY,
      width: ctx.measure,
      height,
      boxStyle,
    });

    let contentY = currentY + BOX.padding;
    const contentX = x + BOX.padding;

    layout.lines.forEach((line) => {
      setTextStyle(ctx, line.level);
      drawText(ctx, line.text, contentX, contentY + body.ascent);
      contentY += body.lineHeight;
    });

    return ctx.endBlock(currentY + height, spaceAfter);
  });
}

/** Options of `parseAddressLines`. */
export interface ParseAddressLinesOptions {
  /** Takes the second line as a subtitle, in `smallMuted`, instead of an address line. Default: `false`. */
  hasSubtitle?: boolean;
}

/**
 * Splits a multi-line address into `AddressLine`s: first line is the title, the second the subtitle when
 * `hasSubtitle` is set, the rest address lines. Blank lines are dropped. Throws an `InvalidOptionError` for an
 * `address` that is no string.
 *
 * @example
 * ```ts
 * import { parseAddressLines } from '@mlt-a/jspdf-toolkit';
 *
 * doc.addressBlock(parseAddressLines('Acme Corp\nBilling\n1 Main Street\nSpringfield', { hasSubtitle: true }));
 * ```
 */
export function parseAddressLines(address: string, options?: ParseAddressLinesOptions): AddressLine[] {
  checkedText('parseAddressLines address', address);
  const hasSubtitle = optionalBoolean('parseAddressLines hasSubtitle', options?.hasSubtitle) === true;
  const addressLines = address.split('\n').filter((line) => line.trim() !== '');
  const result: AddressLine[] = [];

  if (addressLines.length === 0) {
    return result;
  }

  result.push({
    text: addressLines[0],
    role: 'title',
  });

  const withSubtitle = hasSubtitle && addressLines.length > 1;
  const startIndex = withSubtitle ? 2 : 1;

  if (withSubtitle) {
    result.push({ text: addressLines[1], role: 'subtitle' });
  }

  addressLines.slice(startIndex).forEach((line) => {
    result.push({ text: line, role: 'address' });
  });

  return result;
}
