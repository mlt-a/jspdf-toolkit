import { BOX } from '../core/constants';
import type { DrawingContext } from '../core/context';
import { checkedObject, optionalNumber } from '../core/errors';
import type { BoxStylePreset } from './boxes';
import { optionalBoxStyle } from './boxes';
import { remainingTextWidth } from './text-lines';

/** Options of `panel`. All optional. */
export interface PanelOptions {
  /** Fill and border of the frame, a `BoxStylePreset`. Default: `'surface'`. */
  boxStyle?: BoxStylePreset;
  /**
   * Space (mm) between the frame and its content, on its four sides, on every page the panel runs on: 0 or more.
   * Default: 4.
   */
  padding?: number;
  /** Corner radius (mm) of the frame: 0 or more. Default: 1. */
  radius?: number;
  /** Space (mm) under the panel. Default: `theme.spacing.block`. */
  spaceAfter?: number;
}

/** The options of a panel, checked, with their defaults. */
export interface ResolvedPanelOptions {
  boxStyle: BoxStylePreset;
  padding: number;
  radius: number;
  spaceAfter: number;
}

/**
 * The options of a panel drawn in the current frame of `ctx`, checked before anything is drawn: an option out of its
 * bounds, or a padding that leaves the content no width, throws an `InvalidOptionError`.
 */
export function resolvePanelOptions(ctx: DrawingContext, options: PanelOptions | undefined): ResolvedPanelOptions {
  if (options !== undefined) checkedObject('panel options', options);
  const boxStyle = optionalBoxStyle('panel', options?.boxStyle) ?? 'surface';
  const padding = optionalNumber('panel padding (mm)', options?.padding, { min: 0 }) ?? BOX.padding;
  const radius = optionalNumber('panel radius (mm)', options?.radius, { min: 0 }) ?? BOX.radius;
  const spaceAfter = ctx.resolveSpaceAfter(options?.spaceAfter);
  remainingTextWidth('panel', ctx.measure, 2 * padding);
  return { boxStyle, padding, radius, spaceAfter };
}
