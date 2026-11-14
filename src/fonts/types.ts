/** Style of a font face, as jsPDF names them. */
export type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

/**
 * Faces a family lacks on purpose, by family name: `{ Brand: ['italic', 'bolditalic'] }`. Text asked in such a face is
 * drawn in the closest one the family has, without the warning of a missing face. `italic` covers `bolditalic` too; a
 * family without a bold face lists `bold` and `bolditalic`. `normal` is never a fallback.
 */
export type FontFallbacks = Record<string, readonly Exclude<FontStyle, 'normal'>[]>;

/** A font file to embed. `fileName` names the file in jsPDF's virtual file system. */
export type FontSource =
  | {
      /** Font bytes given as a base64 string. */
      type: 'base64';
      /** Family name the theme refers to in `fontFamily`. */
      family: string;
      /** Face this file provides. */
      style: FontStyle;
      /** Base64 content of the TTF file. */
      data: string;
      /** Name of the file in jsPDF's virtual file system; unique per face. */
      fileName: string;
    }
  | {
      /** Font bytes given as a `Uint8Array`. */
      type: 'binary';
      /** Family name the theme refers to in `fontFamily`. */
      family: string;
      /** Face this file provides. */
      style: FontStyle;
      /** Content of the TTF file. */
      data: Uint8Array;
      /** Name of the file in jsPDF's virtual file system; unique per face. */
      fileName: string;
    };
