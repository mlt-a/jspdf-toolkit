import { BOX, LINE_WIDTH, SIGNATURE } from '../core/constants';
import type { DrawingContext } from '../core/context';
import {
  InvalidOptionError,
  POSITIVE,
  checkedObjects,
  checkedText,
  optionalFunction,
  optionalNumber,
  optionalText,
} from '../core/errors';
import { columnGap } from './columns';
import { withDrawingState } from './drawing-state';
import { drawImageInBox } from './image-helpers';
import { levelColor, measureTextLevel, resolveTextStyle, setTextStyle } from './text';
import { text as drawText, remainingTextWidth, wrap } from './text-lines';
import { applyTextStyle } from './text-style';

/** One signature box: label, optional sublabel and optional signature image. */
export interface SignatureItem {
  /** Line at the top of the box, in italics, e.g. `'Client'`; wrapped to the box. */
  label: string;
  /** Detail under the label (signer name and role), wrapped to the box and muted. */
  sublabel?: string;
  /**
   * Signature image: a name given to `registerImage`, or image data. Drawn as large as it fits under the text of the
   * box, its ratio kept, on the left.
   */
  image?: string;
  /** Distance (mm) from the box left edge to the image; a negative value moves it left. Default: 4. */
  imageOffsetX?: number;
  /**
   * Distance (mm) from the box top to the image; a negative value moves it up. Default: just under the label and
   * sublabel.
   */
  imageOffsetY?: number;
  /** Marks the box as a signature spot of an e-signature flow: `renderAnchor` is called on it with this key. */
  anchorKey?: string;
}

/** Bounds (mm) of a signature box, from its top-left corner. */
export interface SignatureBoxBounds {
  /** Left edge (mm), from the left of the page. */
  x: number;
  /** Top edge (mm), from the top of the page. */
  y: number;
  /** Width (mm). */
  width: number;
  /** Height (mm). */
  height: number;
}

/** Options of `signatureZone`. */
export interface SignatureZoneOptions {
  /** Height (mm) of every box; grows to hold the label, sublabel and image. Default: 30. */
  height?: number;
  /** Space (mm) between the two boxes: 0 or more. Default: `SPACING.xlarge`. */
  gap?: number;
  /** Line above the boxes, in italics, e.g. the place and date of signature. Not drawn without a box. */
  caption?: string;
  /** Space (mm) under the boxes. Default: `theme.spacing.block`. */
  spaceAfter?: number;
  /**
   * Called on every box that declares an `anchorKey` and has no `image`, after the box is drawn: place an e-signature
   * anchor there. A box that already carries a signature image gets no anchor.
   */
  renderAnchor?: (ctx: DrawingContext, box: SignatureBoxBounds, anchorKey: string) => void;
}

interface SignatureZoneLayout {
  boxes: SignatureItem[];
  gap: number;
  boxWidth: number;
  innerWidth: number;
  labelLines: string[][];
  sublabelLines: string[][];
  /** Label plus sublabel block, from the top of the box. */
  textBlockHeights: number[];
  /** Height of every box. */
  boxHeight: number;
  /** Height of the caption line and its gap, 0 without `caption`. */
  captionHeight: number;
}

const MAX_BOXES = 2;

/** The options checked and defaulted, before the boxes are looked at. */
interface SignatureZoneFrame {
  gap: number;
  /** Requested height of every box. */
  height: number;
  spaceAfter: number;
}

function signatureZoneFrame(ctx: DrawingContext, options: SignatureZoneOptions): SignatureZoneFrame {
  optionalText('signatureZone caption', options.caption);
  optionalFunction('signatureZone renderAnchor', options.renderAnchor);
  return {
    gap: columnGap('signatureZone', options.gap),
    height: optionalNumber('signatureZone height (mm)', options.height, POSITIVE) ?? SIGNATURE.defaultHeight,
    spaceAfter: ctx.resolveSpaceAfter(options.spaceAfter),
  };
}

/** Every box checked before anything is drawn: an object with its `label`, and its optional texts. */
function checkBoxes(boxes: SignatureItem[]): void {
  checkedObjects('signatureZone boxes', boxes, (box, index) => {
    checkedText(() => `signatureZone boxes[${index}] label`, box.label);
    optionalText(() => `signatureZone boxes[${index}] sublabel`, box.sublabel);
    optionalText(() => `signatureZone boxes[${index}] image`, box.image);
    optionalText(() => `signatureZone boxes[${index}] anchorKey`, box.anchorKey);
  });
}

/** Single source of layout for `drawSignatureZone` and `computeSignatureZoneHeight`. The callers hold the scope. */
function layoutSignatureZone(
  ctx: DrawingContext,
  signatureBoxes: SignatureItem[],
  options: SignatureZoneOptions,
  { gap, height }: SignatureZoneFrame,
): SignatureZoneLayout {
  const { measure } = ctx;
  const note = measureTextLevel(ctx, 'italic');

  if (signatureBoxes.length > MAX_BOXES) {
    throw new InvalidOptionError(`A signature zone holds at most ${MAX_BOXES} boxes, got ${signatureBoxes.length}`);
  }
  const boxes = signatureBoxes;

  const boxWidth = boxes.length === 1 ? measure / 2 : (measure - gap) / 2;
  // Also rejects a `gap` or a `measure` that leaves the boxes no width.
  const innerWidth = remainingTextWidth('a signatureZone box', boxWidth, BOX.padding * 2);
  for (const box of boxes) {
    // Signed: a negative offset moves the image left or up.
    optionalNumber('signatureZone imageOffsetX (mm)', box.imageOffsetX);
    optionalNumber('signatureZone imageOffsetY (mm)', box.imageOffsetY);
  }

  // Labels and sublabels are measured in the style they are drawn in, so the line counts match.
  setTextStyle(ctx, 'italic');
  const labelLines = boxes.map((box) => wrap(ctx, box.label, innerWidth));
  setTextStyle(ctx, 'smallMuted');
  const sublabelLines = boxes.map((box) => (box.sublabel ? wrap(ctx, box.sublabel, innerWidth) : []));
  const textBlockHeights = boxes.map(
    (_box, index) => BOX.padding + note.lineHeight * (labelLines[index].length + sublabelLines[index].length),
  );

  // One height for all boxes: the requested one, or what the tallest text block plus an image needs.
  let boxHeight = height;
  boxes.forEach((box, index) => {
    const need = box.image
      ? textBlockHeights[index] + SIGNATURE.imageGap + SIGNATURE.minImageHeight + BOX.padding
      : textBlockHeights[index] + BOX.padding;
    boxHeight = Math.max(boxHeight, need);
  });

  const captionHeight = options.caption ? note.lineHeight + SIGNATURE.captionGap : 0;
  return { boxes, gap, boxWidth, innerWidth, labelLines, sublabelLines, textBlockHeights, boxHeight, captionHeight };
}

/**
 * Height (mm) of the zone, caption line included and spacing after excluded. Throws an `InvalidOptionError` for more
 * than two boxes.
 *
 *
 * @example
 * ```ts
 * import { computeSignatureZoneHeight } from '@mlt-a/jspdf-toolkit';
 *
 * const height = computeSignatureZoneHeight(doc, [{ label: 'Client' }, { label: 'Supplier' }], { caption: 'Signed in London' });
 * ```
 */
export function computeSignatureZoneHeight(
  ctx: DrawingContext,
  boxes: SignatureItem[],
  options: SignatureZoneOptions = {},
): number {
  const frame = signatureZoneFrame(ctx, options);
  checkBoxes(boxes);
  if (boxes.length === 0) return 0;
  return withDrawingState(ctx, () => {
    const { boxHeight, captionHeight } = layoutSignatureZone(ctx, boxes, options, frame);
    return captionHeight + boxHeight;
  });
}

export function drawSignatureZone(
  ctx: DrawingContext,
  signatureBoxes: SignatureItem[],
  options: SignatureZoneOptions = {},
): number {
  const frame = signatureZoneFrame(ctx, options);
  checkBoxes(signatureBoxes);
  if (signatureBoxes.length === 0) return ctx.peekYPos();
  return withDrawingState(ctx, () => {
    const { doc, theme } = ctx;
    const margin = ctx.margins.left;
    const note = measureTextLevel(ctx, 'italic');

    const layout = layoutSignatureZone(ctx, signatureBoxes, options, frame);
    const { boxes, gap, boxWidth, innerWidth, labelLines, sublabelLines, textBlockHeights, boxHeight: height } = layout;
    const { spaceAfter } = frame;

    // Ensure enough space for entire signature zone
    ctx.ensureSpace(layout.captionHeight + height + spaceAfter);

    const currentY = ctx.getYPos();

    if (options.caption) {
      setTextStyle(ctx, 'italic');
      drawText(ctx, options.caption, margin, currentY + note.ascent);
      ctx.setYPos(currentY + layout.captionHeight);
    }

    const boxStartY = ctx.getYPos();

    boxes.forEach((signatureBox, index) => {
      const boxX = margin + index * (boxWidth + gap);
      const boxY = boxStartY;

      doc.setDrawColor(theme.colors.border);
      doc.setLineWidth(LINE_WIDTH.normal);
      doc.rect(boxX, boxY, boxWidth, height, 'S');

      let textY = boxY + BOX.padding + note.ascent;
      setTextStyle(ctx, 'italic');
      drawText(ctx, labelLines[index], boxX + BOX.padding, textY);
      textY += (labelLines[index].length - 1) * note.lineHeight;

      if (sublabelLines[index].length > 0) {
        // Scoped: `renderAnchor` below sees the label style whether or not there is a sublabel.
        withDrawingState(ctx, () => {
          applyTextStyle(doc, {
            ...resolveTextStyle(ctx, 'smallMuted'),
            color: levelColor(ctx, 'smallMuted', 'subtle'),
          });
          for (const line of sublabelLines[index]) {
            textY += note.lineHeight;
            drawText(ctx, line, boxX + BOX.padding, textY);
          }
        });
      }

      if (signatureBox.image) {
        const imageOffsetX = signatureBox.imageOffsetX ?? BOX.padding;
        const imageOffsetY = signatureBox.imageOffsetY ?? textBlockHeights[index] + SIGNATURE.imageGap;
        const imageHeight = height - imageOffsetY - BOX.padding;

        // An explicit `imageOffsetY` can leave no room: never pass jsPDF a non-positive height. The image keeps its
        // ratio, on the left like the text of the box.
        if (imageHeight > 0) {
          const area = { x: boxX + imageOffsetX, y: boxY + imageOffsetY, width: innerWidth, height: imageHeight };
          drawImageInBox(ctx, signatureBox.image, area, 'signature image');
        }
      } else if (signatureBox.anchorKey && options.renderAnchor) {
        options.renderAnchor(ctx, { x: boxX, y: boxY, width: boxWidth, height }, signatureBox.anchorKey);
      }
    });

    return ctx.endBlock(boxStartY + height, spaceAfter);
  });
}
