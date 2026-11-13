import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

/** The path of a file of `assets/`, for the examples that load an image. */
export function exampleAsset(...parts: string[]): string {
  return join(ASSETS, ...parts);
}
