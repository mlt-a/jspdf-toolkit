import type { jsPDF } from 'jspdf';

import { errorMessage } from '../utils/errors';
import { decodeImageData } from '../utils/image-data';
import { AssetLoadError } from './errors';

/** An image decoded and measured once. Drawn again under `alias`, jsPDF reuses the embedded copy. */
export interface EmbeddedImage {
  alias: string;
  /** Bytes rather than base64, so jsPDF does not decode the data again on every draw. */
  data: Uint8Array;
  /** Pixel size, for the ratio. */
  width: number;
  height: number;
}

/**
 * The one image cache of a document, keyed by the image data string, and the names given to `registerImage`. Every
 * image option resolves here: a registered name first, else image data.
 */
export class ImageCache {
  // A failure is kept too: an image drawn on every page is not decoded again just to fail again.
  private readonly images = new Map<string, EmbeddedImage | Error>();
  private readonly names = new Map<string, string>();

  constructor(private readonly doc: jsPDF) {}

  /**
   * Names `data`. A name already registered keeps its first image: `'same'` when `data` is that image, `'conflict'`
   * otherwise. Throws when `data` is not readable, without registering it.
   */
  register(name: string, data: string): 'new' | 'same' | 'conflict' {
    const registered = this.names.get(name);
    if (registered !== undefined) return registered === data ? 'same' : 'conflict';
    this.get(data);
    this.names.set(name, data);
    return 'new';
  }

  /**
   * `image` is a registered name or base64 image data (data URL or raw). Throws when it is neither, or when jsPDF
   * cannot embed the data. A string that is not image data is never handed to jsPDF, which would read it as a path.
   */
  get(image: string): EmbeddedImage {
    const data = this.names.get(image) ?? image;
    let entry = this.images.get(data);
    if (entry === undefined) {
      entry = this.load(data);
      this.images.set(data, entry);
    }
    if (entry instanceof Error) throw entry;
    return entry;
  }

  private load(image: string): EmbeddedImage | Error {
    // A short name may happen to decode as base64: without a data URL prefix, say what it most likely is.
    const unknown = () =>
      new AssetLoadError(`"${image.slice(0, 50)}" is neither a registered image name nor readable image data`);
    const data = decodeImageData(image);
    if (data === undefined) return unknown();
    try {
      const { width, height } = this.doc.getImageProperties(data);
      if (!(width > 0 && height > 0)) return new AssetLoadError(`invalid image size ${width}x${height}`);
      return { alias: `img-${this.images.size}`, data, width, height };
    } catch (error) {
      if (!image.startsWith('data:')) return unknown();
      return new AssetLoadError(errorMessage(error), { cause: error });
    }
  }
}
