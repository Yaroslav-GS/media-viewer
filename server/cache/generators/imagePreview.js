import sharp from 'sharp';
import { cacheConfig } from '../config.js';

export async function createImagePreview(sourcePath, destinationPath, size) {
  await sharp(sourcePath, { pages: 1, limitInputPixels: 268_402_689 })
    .rotate()
    .resize({
      width: size,
      height: size,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: cacheConfig.imageQuality, effort: cacheConfig.imageEffort })
    .toFile(destinationPath);
}
