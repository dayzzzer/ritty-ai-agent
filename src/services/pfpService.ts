import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { pickRandom } from '../utils/random.js';

type LayerKey = 'background' | 'body' | 'item' | 'extraItem' | 'effect';

interface LayerOption {
  id: string;
  name: string;
  file?: string;
  effectPreset?: string;
}

interface CharacterManifest {
  canvas: { width: number; height: number };
  order: LayerKey[];
  layers: Record<LayerKey, LayerOption[]>;
}

interface SelectedLayer {
  layer: LayerKey;
  option: LayerOption;
}

export interface GeneratedPfp {
  buffer: Buffer;
  selected: Array<{ layer: LayerKey; name: string; id: string }>;
}

export class PfpService {
  private manifestCache?: CharacterManifest;

  constructor(private readonly assetsRoot: string) {}

  private manifestPath(): string {
    return path.join(this.assetsRoot, 'manifest.json');
  }

  private resolveAssetPath(manifestFilePath: string): string {
    if (manifestFilePath.startsWith('/assets/characters/')) {
      const relative = manifestFilePath.replace('/assets/characters/', '');
      return path.join(this.assetsRoot, relative);
    }

    return path.resolve(this.assetsRoot, manifestFilePath);
  }

  private async loadManifest(): Promise<CharacterManifest> {
    if (this.manifestCache) {
      return this.manifestCache;
    }

    const raw = await readFile(this.manifestPath(), 'utf8');
    const parsed = JSON.parse(raw) as CharacterManifest;

    if (!parsed?.canvas || !parsed?.layers || !parsed?.order) {
      throw new Error('Invalid PFP manifest structure.');
    }

    this.manifestCache = parsed;
    return parsed;
  }

  private chooseLayers(manifest: CharacterManifest): SelectedLayer[] {
    const selected: SelectedLayer[] = [];

    for (const layer of manifest.order) {
      const options = manifest.layers[layer] ?? [];
      if (options.length === 0) {
        continue;
      }

      const required = layer === 'background' || layer === 'body';
      const includeOptional = Math.random() > 0.25;
      if (!required && !includeOptional) {
        continue;
      }

      selected.push({ layer, option: pickRandom(options) });
    }

    return selected;
  }

  private async applyEffect(buffer: Buffer, effectPreset: string | undefined): Promise<Buffer> {
    if (!effectPreset) {
      return buffer;
    }

    switch (effectPreset) {
      case 'mono-noir':
        return sharp(buffer).grayscale().modulate({ brightness: 0.92, saturation: 0.2 }).png().toBuffer();
      case 'toxic-green':
        return sharp(buffer).tint({ r: 40, g: 230, b: 80 }).modulate({ saturation: 1.25 }).png().toBuffer();
      case 'frost-cyan':
        return sharp(buffer).tint({ r: 140, g: 245, b: 255 }).modulate({ saturation: 1.1 }).png().toBuffer();
      case 'solar-burn':
        return sharp(buffer).tint({ r: 255, g: 180, b: 90 }).modulate({ brightness: 1.08 }).png().toBuffer();
      case 'ghost-invert':
        return sharp(buffer).negate({ alpha: false }).modulate({ brightness: 0.95 }).png().toBuffer();
      case 'posterize-pop':
        return sharp(buffer).modulate({ saturation: 1.45, brightness: 1.06 }).sharpen(1.1).png().toBuffer();
      case 'glitch-rgb':
        return sharp(buffer).modulate({ saturation: 1.35, brightness: 1.03 }).linear(1.06, -6).png().toBuffer();
      case 'vhs-noise':
        return sharp(buffer).blur(0.45).modulate({ saturation: 0.88, brightness: 0.96 }).png().toBuffer();
      case 'dream-bloom':
        return sharp(buffer).blur(0.7).modulate({ brightness: 1.1, saturation: 1.22 }).png().toBuffer();
      case 'chaos-split':
        return sharp(buffer).modulate({ saturation: 1.4 }).rotate(0.15, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      default:
        return buffer;
    }
  }

  async generateRandomPfp(): Promise<GeneratedPfp> {
    const manifest = await this.loadManifest();
    const chosen = this.chooseLayers(manifest);

    if (chosen.length === 0) {
      throw new Error('No layers were selected for PFP generation.');
    }

    const { width, height } = manifest.canvas;

    let current = sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });
    const overlays: Buffer[] = [];

    for (const item of chosen) {
      if (item.layer === 'effect') {
        continue;
      }

      const file = item.option.file;
      if (!file) {
        continue;
      }

      const resolvedPath = this.resolveAssetPath(file);
      const fit = item.layer === 'background' ? 'cover' : 'contain';

      const overlay = await sharp(resolvedPath)
        .resize(width, height, {
          fit,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      overlays.push(overlay);
    }

    if (overlays.length > 0) {
      current = current.composite(overlays.map((overlay) => ({ input: overlay })));
    }

    let finalBuffer = await current.png().toBuffer();

    const effect = chosen.find((entry) => entry.layer === 'effect')?.option;
    finalBuffer = await this.applyEffect(finalBuffer, effect?.effectPreset);
    finalBuffer = await sharp(finalBuffer)
      .resize({ width: 1024, withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();

    return {
      buffer: finalBuffer,
      selected: chosen.map((entry) => ({
        layer: entry.layer,
        id: entry.option.id,
        name: entry.option.name,
      })),
    };
  }
}
