import sharp from 'sharp';
import { resolve } from 'node:path';

// Reproducible raster icons from the project's own vector artwork.
for (const size of [180, 192, 512]) {
  await sharp(resolve('public/icon-maskable.svg'))
    .resize(size, size)
    .png()
    .toFile(resolve(`public/icon-${size}.png`));
}
