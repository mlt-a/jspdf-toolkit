import type { jsPDF } from 'jspdf';

import { ANSWER_BADGE, CHECKBOX, centerOnCapitals } from '../core/constants';
import type { TextLevel } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { checkedText, optionalChoice, optionalText } from '../core/errors';
import { resolveOptionalColor } from '../theme/colors';
import type { ColorInput } from '../theme/types';
import { withDrawingState } from './drawing-state';
import { measureTextLevel, optionalLevel, resolveTextStyle, setTextStyle } from './text';
import { text as drawText, remainingTextWidth, wrap } from './text-lines';
import { applyTextStyle } from './text-style';

// === Types ===

/** State of a checkbox, or of the box of an inline question: ticked, empty or crossed. */
export type CheckboxVariant = 'checked' | 'empty' | 'cross';

/** Options of `checkbox`. */
export interface CheckboxOptions {
  /** State of the box: `'empty'`, `'checked'` (a tick) or `'cross'`. Default: `'empty'`. */
  variant?: CheckboxVariant;
  /** Text level of the label. Default: `'body'`. */
  level?: TextLevel;
  /** Space (mm) under the checkbox. Default: `theme.spacing.block`. Consecutive checkboxes sit 2 mm apart. */
  spaceAfter?: number;
  /** Color of the box and its mark, instead of the one the variant picks. */
  color?: ColorInput;
}

/** Options of `inlineQuestion`. */
export interface InlineQuestionOptions {
  /** State of the answer box: `'empty'` (not answered), `'checked'` or `'cross'`. Default: `'empty'`. */
  variant?: CheckboxVariant;
  /** Text after the box, in bold. */
  answer?: string;
  /** Space (mm) under the question. Default: `theme.spacing.block`. */
  spaceAfter?: number;
  /** Color of the box and the answer, instead of the one the variant picks. */
  color?: ColorInput;
}

// === Vectorial checkbox icon ===

function drawCheckboxIcon(
  doc: jsPDF,
  x: number,
  y: number,
  size: number,
  variant: CheckboxVariant,
  color: string,
): void {
  const r = size * 0.11;
  const strokeWidth = size * 0.08;

  // The `withDrawingState` of the caller puts back the color, width, cap and join: the round ends stop here.
  doc.setDrawColor(color);
  doc.setLineCap('round');
  doc.setLineJoin('round');

  doc.setLineWidth(strokeWidth);
  doc.roundedRect(x, y, size, size, r, r, 'S');

  if (variant !== 'empty') {
    doc.setLineWidth(strokeWidth * 1.8);

    if (variant === 'checked') {
      // Checkmark — normalized from Lucide check path within the square
      doc.line(x + 0.25 * size, y + 0.5 * size, x + 0.45 * size, y + 0.7 * size);
      doc.line(x + 0.45 * size, y + 0.7 * size, x + 0.78 * size, y + 0.28 * size);
    } else {
      // Cross — normalized from Lucide x paths
      doc.line(x + 0.28 * size, y + 0.28 * size, x + 0.72 * size, y + 0.72 * size);
      doc.line(x + 0.72 * size, y + 0.28 * size, x + 0.28 * size, y + 0.72 * size);
    }
  }
}

// === Public API ===

const VARIANT_COLOR = {
  checked: 'primary',
  empty: 'secondary',
  cross: 'error',
} as const satisfies Record<CheckboxVariant, ColorInput>;

const VARIANTS = ['checked', 'empty', 'cross'] as const satisfies readonly CheckboxVariant[];

/** The inline question marks an answered "yes" as a success, not as the primary accent of a checkbox. */
const INLINE_CHECKED_COLOR = 'success';

export function drawCheckbox(ctx: DrawingContext, label: string, options?: CheckboxOptions): number {
  return withDrawingState(ctx, () => {
    const { doc, theme } = ctx;
    const margin = ctx.margins.left;
    const variant = optionalChoice('checkbox variant', options?.variant, VARIANTS) ?? 'empty';
    const level = optionalLevel('checkbox', options?.level) ?? 'body';
    checkedText('checkbox label', label);
    // Before the page break: an invalid color must not leave a page behind.
    const color = resolveOptionalColor(theme, options?.color, VARIANT_COLOR[variant]);
    const metrics = measureTextLevel(ctx, level);
    const spaceAfter = ctx.resolveSpaceAfter(options?.spaceAfter);

    // A long label wraps in what the box leaves of the frame; the box stays on its first line.
    const besideBox = CHECKBOX.size + CHECKBOX.gap;
    const labelWidth = remainingTextWidth('a checkbox label', ctx.measure, besideBox);
    setTextStyle(ctx, level);
    const lines = wrap(ctx, label, labelWidth);
    const height = Math.max(1, lines.length) * metrics.lineHeight;

    // Under another checkbox, the box joins the group; the space under it stays its own.
    ctx.attachTo('checkbox', CHECKBOX.groupGap, height + spaceAfter);

    const currentY = ctx.getYPos();
    const baseline = currentY + metrics.ascent;
    const iconY = centerOnCapitals(baseline, metrics, CHECKBOX.size);

    drawCheckboxIcon(doc, margin, iconY, CHECKBOX.size, variant, color);

    // After the room is reserved: placing a waiting heading changes the text style.
    setTextStyle(ctx, level);
    drawText(ctx, lines, margin + besideBox, baseline);

    // The next checkbox may attach to it.
    return ctx.endBlock(currentY + height, options?.spaceAfter, { kind: 'checkbox' });
  });
}

export function drawInlineQuestion(ctx: DrawingContext, question: string, options?: InlineQuestionOptions): number {
  return withDrawingState(ctx, () => {
    const { doc, measure, theme } = ctx;
    const margin = ctx.margins.left;
    const variant = optionalChoice('inlineQuestion variant', options?.variant, VARIANTS) ?? 'empty';
    const answer = optionalText('inlineQuestion answer', options?.answer);
    checkedText('inlineQuestion question', question);
    const body = measureTextLevel(ctx, 'body');
    const color = resolveOptionalColor(
      theme,
      options?.color,
      variant === 'checked' ? INLINE_CHECKED_COLOR : VARIANT_COLOR[variant],
    );
    const spaceAfter = ctx.resolveSpaceAfter(options?.spaceAfter);

    // The answer is drawn bold: measure it with the same font. It ends on the right edge of the reading column.
    let answerWidth = 0;
    if (answer) {
      setTextStyle(ctx, 'bodyBold');
      answerWidth = doc.getTextWidth(answer) + ANSWER_BADGE.gap;
    }
    const badgeX = margin + measure - answerWidth - ANSWER_BADGE.size;

    // A long question wraps before the badge instead of running under it.
    const questionWidth = remainingTextWidth(
      'an inlineQuestion',
      measure,
      answerWidth + ANSWER_BADGE.size + ANSWER_BADGE.questionGap,
    );
    setTextStyle(ctx, 'body');
    const lines = wrap(ctx, question, questionWidth);
    const height = lines.length * body.lineHeight;

    ctx.ensureSpace(height + spaceAfter);

    const currentY = ctx.getYPos();
    const baseline = currentY + body.ascent;
    const badgeY = centerOnCapitals(baseline, body, ANSWER_BADGE.size);

    drawText(ctx, lines, margin, baseline);

    drawCheckboxIcon(doc, badgeX, badgeY, ANSWER_BADGE.size, variant, color);

    if (answer) {
      // The answer takes the color of its badge.
      applyTextStyle(doc, { ...resolveTextStyle(ctx, 'bodyBold'), color });
      drawText(ctx, answer, badgeX + ANSWER_BADGE.size + ANSWER_BADGE.gap, baseline);
    }

    return ctx.endBlock(currentY + height, spaceAfter);
  });
}
