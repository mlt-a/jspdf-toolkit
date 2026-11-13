import type { PDFDocument } from './document';

/**
 * What a drawing primitive receives: the `PDFDocument` itself. The name says what drawing code reads and moves; a
 * custom component takes a `DrawingContext` like the primitives of `src/drawing`, `src/page` and `src/table`.
 *
 * Contract of the primitives:
 * - Flow primitives reserve their room with `ensureSpace` (it breaks the page), draw from `getYPos()` and close with
 *   `endBlock(bottom, spaceAfter)`, whose result they return. `endBlock` defaults `spaceAfter` to
 *   `theme.spacing.block`; a primitive that reserves that space first reads it from `resolveSpaceAfter`. One that asks
 *   for space above it calls `beginBlock(spaceBefore)` after `ensureSpace`. Spaces collapse: the larger of the two
 *   separates two blocks.
 * - A flow primitive checks its options first, then its input: an invalid option throws whether there is something to
 *   draw or not. Given nothing to draw (no item, empty text), it returns the current position without placing the
 *   waiting headings, and its `compute*Height` returns 0: a block with nothing in it is no block, so the position, the
 *   space left by the block above and the waiting headings stay as they were.
 * - Primitives placed by coordinates take `y` as the top of what they draw and return the Y under it.
 * - Page decorations, drawn whatever the position (watermark, running header and footer), return nothing.
 *
 * The class has private members: the compiler refuses a hand-built object, which would lack the members marked
 * internal that the library's own primitives call.
 */
export type DrawingContext = PDFDocument;
