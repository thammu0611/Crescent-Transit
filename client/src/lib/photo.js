export const PHOTO_CHANGED = 'ubts:photo-changed';

/** Shrink a chosen picture to a square 256 px JPEG: small enough to store and quick to show. */
export async function squarePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture file');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  return canvas.toDataURL('image/jpeg', 0.8);
}
