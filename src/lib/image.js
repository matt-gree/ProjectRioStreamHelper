/*
 * Shrink an uploaded raster image to a size an overlay can actually use.
 *
 * League art arrives at print sizes — a 2160×2160 PNG is 4.5 MB — while the
 * largest place a team logo is drawn on a 1080p canvas is a couple of hundred
 * pixels across. Sent as-is it hit the server's size cap, and even under the
 * cap it would ride inside every shared book export as base64 and be decoded
 * by every OBS browser source that shows it. So anything larger than
 * `maxSide` on its long edge is redrawn at `maxSide` and re-encoded as PNG
 * (alpha kept — logos are cut out). SVG is left alone: it has no pixels to
 * shed, and rasterising it would only make it worse.
 *
 * Returns the original File when there is nothing to gain, or when the browser
 * cannot decode it (the server's own type check then answers).
 */
export async function shrinkImage(file, maxSide = 1024) {
    if (!file || file.type === 'image/svg+xml' || typeof createImageBitmap !== 'function') return file;
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        return file;
    }
    const { width, height } = bitmap;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    if (scale === 1) {
        bitmap.close?.();
        return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.png';
    return new File([blob], name, { type: 'image/png' });
}
