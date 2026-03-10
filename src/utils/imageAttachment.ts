import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

export interface ImageAttachment {
  name: string;
  buffer: Buffer;
}

export async function buildFileAttachmentFromPath(filePath: string): Promise<ImageAttachment> {
  const buffer = await readFile(filePath);
  return {
    name: path.basename(filePath),
    buffer,
  };
}

export async function buildImageAttachmentFromPath(imagePath: string): Promise<ImageAttachment> {
  const ext = path.extname(imagePath).toLowerCase();
  const baseName = path.basename(imagePath, ext);

  if (ext === '.svg') {
    const buffer = await sharp(imagePath).png().toBuffer();
    return {
      name: `${baseName}.png`,
      buffer,
    };
  }

  const buffer = await sharp(imagePath)
    .resize({ width: 520, withoutEnlargement: true })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 62, mozjpeg: true })
    .toBuffer();

  return {
    name: `${baseName}.jpg`,
    buffer,
  };
}
