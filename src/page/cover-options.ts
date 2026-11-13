import type { LogoPlacement } from './logo';

/** Options common to every cover variant. */
export interface CoverBaseOptions {
  /** Line(s) under the title. */
  subtitle?: string;
  /** Page image: a name given to `registerImage`, or image data. The variant sets where it goes. */
  image?: string;
  /** Logo position and size. The variant sets the default. */
  logo?: LogoPlacement;
}
