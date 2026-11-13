// Chunked so String.fromCharCode never receives more arguments than the engine allows.
const CHUNK_SIZE = 0x8000;

/** Encodes bytes as base64 without Node's Buffer, so the core stays browser-safe. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}
