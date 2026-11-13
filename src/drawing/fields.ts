import { FIELD, LAYOUT } from '../core/constants';
import type { TextLevel } from '../core/constants';
import type { DrawingContext } from '../core/context';
import {
  checkedArray,
  optionalChoice,
  checkedObjects,
  checkedText,
  optionalBoolean,
  optionalNumber,
  optionalText,
} from '../core/errors';
import { columnWidth } from './columns';
import { withDrawingState } from './drawing-state';
import type { HighlightMetrics } from './highlights';
import { drawPill, inlinePillBox, measureHighlightedText } from './highlights';
import type { FlowLayout, LeaderRowLayout } from './rich';
import { drawFlow, drawLeaderRow, layoutFlow, layoutLeaderRow } from './rich';
import { levelColor, measureTextLevel, resolveTextStyle, setTextStyle } from './text';
import { normalizeText, text, wrap } from './text-lines';
import { applyFont } from './text-style';

/** A label/value pair. `highlight` draws the value as a pill; `complement` adds a note after it. */
export interface Field {
  /** Name of the field, in the label level of the layout (see `FieldsOptions.layout`). */
  label: string;
  /** Value of the field, in the value level of the layout (see `FieldsOptions.layout`). */
  value: string;
  /** Draws the value in a pill. Default: `false`. */
  highlight?: boolean;
  /** Note under the value, in muted small text. */
  complement?: string;
}

/** How fields are laid out: `stacked`, `inline` or `leader`. */
export type FieldLayout = 'stacked' | 'inline' | 'leader';

/** Options of `fields` and `fieldRows`. */
export interface FieldsOptions {
  /** Space (mm) under the block: under the last row for `fieldRows`. Default: `theme.spacing.block`. */
  spaceAfter?: number;
  /**
   * Space (mm) between two rows of `fieldRows`: 0 or more. Default: `SPACING.small` for `'stacked'`, `SPACING.medium`
   * for `'inline'` and `'leader'`, whose fields of a row are already `SPACING.xsmall` apart.
   */
  rowGap?: number;
  /**
   * - `'stacked'` (default): the label above the value, the fields of a row side by side in columns.
   * - `'inline'`: one field per line, `Label: value`. A long value wraps under itself, after the label. A highlighted
   *   value keeps its pill. A label wider than half the line falls back to `'stacked'` for that field.
   * - `'leader'`: one field per line, the label on the left, the value on the right in bold or as a pill, dotted
   *   leader between them. A value wider than half the line goes on its own right-aligned lines under the label, with
   *   no leader.
   *
   * `'inline'` and `'leader'` give every field its own full-width line, so a row of `fieldRows` is a group of lines.
   *
   * The text levels a theme restyles (`typography.levels`) for each layout: `'stacked'` and `'inline'` set the label
   * in `fieldLabel` and the value in `fieldValue`; `'leader'` sets the label in `body` (in the color of `fieldLabel`)
   * and the value in `bodyBold`, so a leader row reads as a line of text. A complement is set in `smallMuted`.
   */
  layout?: FieldLayout;
}

/** Text levels of the label and the value of each layout: what `FieldsOptions.layout` documents. */
const FIELD_LEVELS = {
  stacked: { label: 'fieldLabel', value: 'fieldValue' },
  inline: { label: 'fieldLabel', value: 'fieldValue' },
  leader: { label: 'body', value: 'bodyBold' },
} as const satisfies Record<FieldLayout, { label: TextLevel; value: TextLevel }>;

/** The layouts, as `FieldsOptions.layout` takes them. */
const LAYOUTS = ['stacked', 'inline', 'leader'] as const satisfies readonly FieldLayout[];

/** The fields of a row checked: each an object with its `label` and its `value`, and its optional `highlight` and `complement`. */
function checkFieldRow(what: string, row: Field[]): void {
  checkedObjects(what, row, (field, index) => {
    checkedText(() => `${what}[${index}] label`, field.label);
    checkedText(() => `${what}[${index}] value`, field.value);
    optionalBoolean(() => `${what}[${index}] highlight`, field.highlight);
    optionalText(() => `${what}[${index}] complement`, field.complement);
  });
}

export function drawFields(ctx: DrawingContext, fields: Field[], options?: FieldsOptions): number {
  checkFieldRow('fields', fields);
  return drawRows(ctx, [fields], options);
}

export function drawFieldRows(ctx: DrawingContext, rows: Field[][], options?: FieldsOptions): number {
  // Every field of every row is checked before the first row is drawn.
  checkedArray('fieldRows', rows).forEach((row, index) => checkFieldRow(`fieldRows[${index}]`, row));
  return drawRows(ctx, rows, options);
}

function drawRows(ctx: DrawingContext, rows: Field[][], options?: FieldsOptions): number {
  const layout = optionalChoice('fields layout', options?.layout, LAYOUTS) ?? 'stacked';
  const rowGap = optionalNumber('fieldRows rowGap (mm)', options?.rowGap, { min: 0 }) ?? FIELD.rowGap[layout];
  const spaceAfter = ctx.resolveSpaceAfter(options?.spaceAfter);
  // The widest stacked row leaves its fields the narrowest columns: checked before the first row is drawn.
  if (layout === 'stacked') columnWidth(ctx.measure, Math.max(1, ...rows.map((row) => row.length)), LAYOUT.columnGap);

  // An empty row draws nothing: it must not take the place of the last row, which carries `spaceAfter`.
  const drawnRows = rows.filter((row) => row.length > 0);
  drawnRows.forEach((row, rowIndex) => {
    const gapAfterRow = rowIndex === drawnRows.length - 1 ? spaceAfter : rowGap;
    if (layout === 'stacked') {
      drawFieldRow(ctx, row, layout, gapAfterRow);
      return;
    }
    // One field per line: `lineGap` between the lines of a row.
    row.forEach((field, index) => {
      const gapAfterLine = index === row.length - 1 ? gapAfterRow : FIELD.lineGap;
      drawFieldRow(ctx, [field], layout, gapAfterLine);
    });
  });
  // Without a field nothing was drawn: a waiting heading keeps waiting.
  return ctx.peekYPos();
}

/** Draws the fields of one row side by side, then moves down by the tallest one plus `gapAfter`. */
function drawFieldRow(ctx: DrawingContext, fields: Field[], layout: FieldLayout, gapAfter: number): number {
  return withDrawingState(ctx, () => {
    const { measure } = ctx;
    const margin = ctx.margins.left;

    const width = columnWidth(measure, fields.length, LAYOUT.columnGap);

    // Measured once per field and reused by the drawing, so height and rendering cannot diverge.
    const metrics = fields.map((field) => measureField(ctx, field, width, layout));
    const maxHeight = Math.max(...metrics.map((m) => m.height));

    ctx.ensureSpace(maxHeight + gapAfter);

    const currentY = ctx.getYPos();

    metrics.forEach((fieldMetrics, index) => {
      const columnX = margin + index * (width + LAYOUT.columnGap);
      drawSingleField(ctx, columnX, currentY, fieldMetrics);
    });

    return ctx.endBlock(currentY + maxHeight, gapAfter);
  });
}

interface StackedMetrics {
  layout: 'stacked';
  height: number;
  labelLines: string[];
  /** The value: a highlight pill, or plain lines. */
  value: { pill: HighlightMetrics } | { valueLines: string[] };
  complementLines: string[];
}

interface InlineMetrics {
  layout: 'inline';
  height: number;
  /** `Label:` as a hanging prefix, then the value. */
  flow: FlowLayout;
  /** Left edge (mm) of the value, from the field left. */
  gutter: number;
  complementLines: string[];
}

interface LeaderMetrics {
  layout: 'leader';
  height: number;
  row: LeaderRowLayout;
  complementLines: string[];
}

type FieldMetrics = StackedMetrics | InlineMetrics | LeaderMetrics;

function wrapComplement(ctx: DrawingContext, field: Field, width: number): { lines: string[]; height: number } {
  if (!field.complement) return { lines: [], height: 0 };
  const note = measureTextLevel(ctx, 'smallMuted');
  setTextStyle(ctx, 'smallMuted');
  const lines = wrap(ctx, field.complement, width);
  return { lines, height: FIELD.complementGap + lines.length * note.lineHeight };
}

/** Single measuring pass, shared by the drawing: line breaks and height of a field in a column of `width`. */
function measureField(ctx: DrawingContext, field: Field, width: number, layout: FieldLayout = 'stacked'): FieldMetrics {
  switch (layout) {
    case 'inline':
      return measureInlineField(ctx, field, width);
    case 'leader':
      return measureLeaderField(ctx, field, width);
    case 'stacked':
      return measureStackedField(ctx, field, width);
  }
}

function measureStackedField(ctx: DrawingContext, field: Field, width: number): StackedMetrics {
  const levels = FIELD_LEVELS.stacked;
  const label = measureTextLevel(ctx, levels.label);
  const value = measureTextLevel(ctx, levels.value);

  // Labels wrap to the column instead of running into the neighbour column.
  setTextStyle(ctx, levels.label);
  const labelLines = wrap(ctx, field.label, width);
  let height = labelLines.length * label.lineHeight + FIELD.labelGap;

  let valueMetrics: StackedMetrics['value'];
  if (field.highlight) {
    const pill = measureHighlightedText(ctx, field.value, { maxWidth: width });
    // On the baseline of a plain value: the value takes the room down to the bottom of the pill.
    const box = inlinePillBox(pill, value.ascent);
    height += box.top + box.height + FIELD.pillGap;
    valueMetrics = { pill };
  } else {
    setTextStyle(ctx, levels.value);
    const valueLines = wrap(ctx, field.value, width);
    height += valueLines.length * value.lineHeight;
    valueMetrics = { valueLines };
  }

  const complement = wrapComplement(ctx, field, width);
  height += complement.height;

  return { layout: 'stacked', height, labelLines, value: valueMetrics, complementLines: complement.lines };
}

/** A label too wide to leave room for the value falls back to the stacked layout. */
function measureInlineField(ctx: DrawingContext, field: Field, width: number): InlineMetrics | StackedMetrics {
  const levels = FIELD_LEVELS.inline;
  const labelStyle = resolveTextStyle(ctx, levels.label);
  const valueStyle = resolveTextStyle(ctx, levels.value);
  const { lineHeight } = measureTextLevel(ctx, levels.value);

  const prefix = `${normalizeText(field.label)}:`;
  applyFont(ctx.doc, labelStyle);
  const gutter = ctx.doc.getTextWidth(prefix) + FIELD.inlineGap;
  if (gutter > width * FIELD.sideMaxRatio) return measureStackedField(ctx, field, width);

  const flow = layoutFlow(
    ctx,
    [field.highlight ? { pill: field.value } : { text: normalizeText(field.value), style: valueStyle }],
    { width, lineHeight, prefix: { text: prefix, style: labelStyle, width: gutter } },
  );
  const complement = wrapComplement(ctx, field, width - gutter);
  return { layout: 'inline', height: flow.height + complement.height, flow, gutter, complementLines: complement.lines };
}

function measureLeaderField(ctx: DrawingContext, field: Field, width: number): LeaderMetrics {
  const levels = FIELD_LEVELS.leader;
  const row = layoutLeaderRow(ctx, {
    label: field.label,
    labelStyle: { ...resolveTextStyle(ctx, levels.label), color: levelColor(ctx, 'fieldLabel') },
    value: field.highlight ? { pill: field.value } : { text: field.value, style: resolveTextStyle(ctx, levels.value) },
    width,
    lineHeight: measureTextLevel(ctx, levels.label).lineHeight,
    minRun: FIELD.leaderMinRun,
  });
  const complement = wrapComplement(ctx, field, width);
  return { layout: 'leader', height: row.height + complement.height, row, complementLines: complement.lines };
}

function drawSingleField(ctx: DrawingContext, x: number, startY: number, metrics: FieldMetrics): void {
  if (metrics.layout === 'inline') return drawInlineField(ctx, x, startY, metrics);
  if (metrics.layout === 'leader') return drawLeaderField(ctx, x, startY, metrics);
  drawStackedField(ctx, x, startY, metrics);
}

function drawComplement(ctx: DrawingContext, lines: string[], x: number, top: number): void {
  if (lines.length === 0) return;
  const note = measureTextLevel(ctx, 'smallMuted');
  setTextStyle(ctx, 'smallMuted');
  text(ctx, lines, x, top + FIELD.complementGap + note.ascent);
}

function drawInlineField(ctx: DrawingContext, x: number, startY: number, metrics: InlineMetrics): void {
  const { ascent } = measureTextLevel(ctx, FIELD_LEVELS.inline.value);
  drawFlow(ctx, metrics.flow, x, startY, ascent);
  drawComplement(ctx, metrics.complementLines, x + metrics.gutter, startY + metrics.flow.height);
}

function drawLeaderField(ctx: DrawingContext, x: number, startY: number, metrics: LeaderMetrics): void {
  drawLeaderRow(ctx, metrics.row, x, startY);
  drawComplement(ctx, metrics.complementLines, x, startY + metrics.row.height);
}

function drawStackedField(ctx: DrawingContext, x: number, startY: number, metrics: StackedMetrics): void {
  const levels = FIELD_LEVELS.stacked;
  const label = measureTextLevel(ctx, levels.label);
  const value = measureTextLevel(ctx, levels.value);

  setTextStyle(ctx, levels.label);
  text(ctx, metrics.labelLines, x, startY + label.ascent);

  let valueY = startY + metrics.labelLines.length * label.lineHeight + FIELD.labelGap;

  if ('pill' in metrics.value) {
    // The pill text sits on the baseline of a plain value; its padding may bleed into the gap above.
    const baseline = valueY + value.ascent;
    drawPill(ctx, metrics.value.pill, x, baseline, false);
    const box = inlinePillBox(metrics.value.pill, baseline);
    valueY = box.top + box.height + FIELD.pillGap;
  } else {
    setTextStyle(ctx, levels.value);
    text(ctx, metrics.value.valueLines, x, valueY + value.ascent);
    valueY += metrics.value.valueLines.length * value.lineHeight;
  }

  drawComplement(ctx, metrics.complementLines, x, valueY);
}
