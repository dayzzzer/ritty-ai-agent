import { pickRandom } from '../utils/random.js';
import type { ArtworkItem } from './types.js';

interface ArtsApiResponse {
  items?: ArtworkItem[];
}

export class ArtService {
  private readonly cache: ArtworkItem[] = [];
  private lastFetchAt = 0;

  constructor(private readonly apiUrl: string) {}

  async getRandomArtwork(): Promise<ArtworkItem> {
    const items = await this.getApprovedArtworks();
    return pickRandom(items);
  }

  async getApprovedArtworks(): Promise<ArtworkItem[]> {
    const now = Date.now();
    const cacheValid = now - this.lastFetchAt < 60_000;
    if (cacheValid && this.cache.length > 0) {
      return this.cache;
    }

    const response = await fetch(this.apiUrl, {
      headers: {
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (this.cache.length > 0) {
        return this.cache;
      }
      throw new Error(`Failed to fetch artworks: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ArtsApiResponse;
    const items = (payload.items ?? []).filter((item) => item?.src && item?.author);

    if (items.length === 0 && this.cache.length > 0) {
      return this.cache;
    }

    if (items.length === 0) {
      throw new Error('No approved artworks returned by API.');
    }

    this.cache.splice(0, this.cache.length, ...items);
    this.lastFetchAt = now;

    return this.cache;
  }
}
