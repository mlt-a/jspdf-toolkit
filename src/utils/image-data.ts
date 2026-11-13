const DATA_URL_PREFIX = /^data:[^,]*;base64,/;

/**
 * Bytes of an image given as a base64 data URL or raw base64. `undefined` when the string is neither, such as an icon
 * name: jsPDF would read that as a file path.
 */
export function decodeImageData(image: string): Uint8Array | undefined {
  const payload = image.replace(DATA_URL_PREFIX, '');
  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    return undefined;
  }
  if (binary.length === 0) return undefined;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
