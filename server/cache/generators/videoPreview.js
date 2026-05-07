import sharp from 'sharp';
import { cacheConfig } from '../config.js';

export async function createVideoPreview(sourcePath, destinationPath, size) {
  await createVideoPlaceholder(destinationPath, size);
}

async function createVideoPlaceholder(destinationPath, size) {
  const width = size;
  const height = Math.round(size * 0.5625);
  const radius = Math.round(size * 0.12);
  const triangleSize = Math.round(size * 0.12);
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#11151a"/>
      <rect x="0" y="0" width="${width}" height="${height}" fill="#202833" opacity="0.55"/>
      <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="#000" opacity="0.55"/>
      <polygon points="${centerX - triangleSize / 2},${centerY - triangleSize} ${centerX - triangleSize / 2},${centerY + triangleSize} ${centerX + triangleSize},${centerY}" fill="#fff"/>
    </svg>
  `;

  await sharp(Buffer.from(svg)).jpeg({ quality: cacheConfig.videoQuality }).toFile(destinationPath);
}
