/** Style of a font face, as jsPDF names them. */
export type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

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
