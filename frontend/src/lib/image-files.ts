/**
 * Picking an image file in the browser: which types the API accepts, and
 * reading one as the base64 body a request carries.
 *
 * Mirrors `SUPPORTED_IMAGE_MEDIA_TYPES` in `app/providers/chat/content.py` —
 * the one set both chat attachments and query images are validated against,
 * so a surface that offered a wider list would refuse the file after the
 * upload rather than at pick time.
 */

export const SUPPORTED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/** `accept` attribute for a file input restricted to those types. */
export const IMAGE_FILE_ACCEPT = Array.from(SUPPORTED_IMAGE_TYPES).join(",");

/** Read a file as the base64 payload, without the data-URI prefix. */
export function readImageAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}
