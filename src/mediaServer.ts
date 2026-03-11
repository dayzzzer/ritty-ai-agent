import { createServer, type ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { logger } from './logger.js';
import { PfpService } from './services/pfpService.js';
import { getRittyActionById } from './actions/rittyActions.js';

loadEnv();

interface ArtworkItem {
  title?: string;
  author: string;
  src: string;
  twitter?: string;
}

interface CachedPfp {
  buffer: Buffer;
  selected: Array<{ layer: string; id: string; name: string }>;
  createdAt: number;
}

interface CachedArt {
  buffer: Buffer;
  contentType: string;
  item: ArtworkItem;
  createdAt: number;
}

const pfpAssetsRoot = path.resolve(process.env.PFP_ASSETS_ROOT ?? './assets/characters');
const mediaPublicBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL;
const artsApiUrl = process.env.ARTS_API_URL ?? 'https://ritualarts.xyz/api/arts';
const whatIsRitualImagePath = path.resolve(process.env.WHAT_IS_RITUAL_IMAGE_PATH ?? './files by user/what is ritual/ritual-chain.svg');

const pfpService = new PfpService(pfpAssetsRoot);
const pfpCache = new Map<string, CachedPfp>();
const artCache = new Map<string, CachedArt>();
const IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let artworksCache: ArtworkItem[] = [];
let artworksCacheFetchedAt = 0;

const siggyImageByRarity: Record<string, string> = {
  common: path.resolve(process.env.SIGGY_COMMON_IMAGE_PATH ?? './files by user/common/common.png'),
  rare: path.resolve(process.env.SIGGY_RARE_IMAGE_PATH ?? './files by user/Rare/rare.png'),
  epic: path.resolve(process.env.SIGGY_EPIC_IMAGE_PATH ?? './files by user/epic/epic.png'),
  legendary: path.resolve(process.env.SIGGY_LEGENDARY_IMAGE_PATH ?? './files by user/legendary/legendary.png'),
  forbidden: path.resolve(process.env.SIGGY_FORBIDDEN_IMAGE_PATH ?? './files by user/forbidden/forbidden.png'),
};

function getMimeByPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function cleanupCache(): void {
  const now = Date.now();
  for (const [id, item] of pfpCache.entries()) {
    if (now - item.createdAt > IMAGE_CACHE_TTL_MS) {
      pfpCache.delete(id);
    }
  }
  for (const [id, item] of artCache.entries()) {
    if (now - item.createdAt > IMAGE_CACHE_TTL_MS) {
      artCache.delete(id);
    }
  }
}

setInterval(cleanupCache, 60 * 1000);

function jsonResponse(body: unknown, status = 200): { status: number; body: string; contentType: string } {
  return {
    status,
    body: JSON.stringify(body),
    contentType: 'application/json; charset=utf-8',
  };
}

function resolveBaseUrl(hostHeader: string | undefined): string | null {
  if (mediaPublicBaseUrl) {
    return mediaPublicBaseUrl;
  }
  if (!hostHeader) {
    return null;
  }
  return `https://${hostHeader}`;
}

function writeBinaryResponse(
  method: string,
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: Buffer,
): void {
  res.writeHead(status, headers);
  if (method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

async function getArtworks(): Promise<ArtworkItem[]> {
  const now = Date.now();
  if (artworksCache.length > 0 && now - artworksCacheFetchedAt < 60_000) {
    return artworksCache;
  }

  const response = await fetch(artsApiUrl, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch artworks: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { items?: ArtworkItem[] };
  const items = (payload.items ?? []).filter((item) => item?.src && item?.author);
  if (items.length === 0) {
    throw new Error('No artworks returned by API.');
  }

  artworksCache = items;
  artworksCacheFetchedAt = now;
  return artworksCache;
}

const server = createServer(async (req, res) => {
  try {
    const method = req.method ?? 'GET';
    const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = requestUrl.pathname;

    if (method === 'GET' && pathname === '/health') {
      const out = jsonResponse({ ok: true, service: 'ritty-media' });
      res.writeHead(out.status, { 'content-type': out.contentType });
      res.end(out.body);
      return;
    }

    if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/media/siggy/')) {
      const rarity = pathname.slice('/media/siggy/'.length).toLowerCase();
      const imagePath = siggyImageByRarity[rarity];
      if (!imagePath) {
        const out = jsonResponse({ error: 'Unknown rarity' }, 404);
        res.writeHead(out.status, { 'content-type': out.contentType });
        res.end(out.body);
        return;
      }

      const image = await readFile(imagePath);
      writeBinaryResponse(
        method,
        res,
        200,
        {
          'content-type': getMimeByPath(imagePath),
          'cache-control': 'public, max-age=3600',
        },
        image,
      );
      return;
    }

    if ((method === 'GET' || method === 'HEAD') && pathname === '/media/what-is-ritual.svg') {
      const image = await readFile(whatIsRitualImagePath);
      writeBinaryResponse(
        method,
        res,
        200,
        {
          'content-type': getMimeByPath(whatIsRitualImagePath),
          'cache-control': 'public, max-age=3600',
        },
        image,
      );
      return;
    }

    if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/media/action/')) {
      const rawActionId = decodeURIComponent(pathname.slice('/media/action/'.length));
      const actionId = rawActionId.replace(/\.mp4$/i, '').trim();
      const action = getRittyActionById(actionId);
      if (!action) {
        const out = jsonResponse({ error: 'Unknown action' }, 404);
        res.writeHead(out.status, { 'content-type': out.contentType });
        res.end(out.body);
        return;
      }

      const video = await readFile(action.videoPath);
      writeBinaryResponse(
        method,
        res,
        200,
        {
          'content-type': 'video/mp4',
          'cache-control': 'public, max-age=3600',
        },
        video,
      );
      return;
    }

    if (method === 'GET' && pathname === '/api/pfp/random') {
      const baseUrl = resolveBaseUrl(req.headers.host);
      if (!baseUrl) {
        const out = jsonResponse({ error: 'Missing host header' }, 500);
        res.writeHead(out.status, { 'content-type': out.contentType });
        res.end(out.body);
        return;
      }

      const generated = await pfpService.generateRandomPfp();
      const id = randomUUID();
      pfpCache.set(id, {
        buffer: generated.buffer,
        selected: generated.selected,
        createdAt: Date.now(),
      });

      const out = jsonResponse({
        imageUrl: `${baseUrl}/media/pfp/${id}.jpg`,
        selected: generated.selected,
      });
      res.writeHead(out.status, { 'content-type': out.contentType, 'cache-control': 'no-store' });
      res.end(out.body);
      return;
    }

    if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/media/pfp/')) {
      const id = pathname.slice('/media/pfp/'.length).replace(/\.jpg$/i, '');
      const item = pfpCache.get(id);
      if (!item) {
        const out = jsonResponse({ error: 'Not found' }, 404);
        res.writeHead(out.status, { 'content-type': out.contentType });
        res.end(out.body);
        return;
      }

      writeBinaryResponse(
        method,
        res,
        200,
        {
          'content-type': 'image/jpeg',
          'cache-control': 'public, max-age=86400, immutable',
        },
        item.buffer,
      );
      return;
    }

    if (method === 'GET' && pathname === '/api/art/random') {
      const baseUrl = resolveBaseUrl(req.headers.host);
      if (!baseUrl) {
        const out = jsonResponse({ error: 'Missing host header' }, 500);
        res.writeHead(out.status, { 'content-type': out.contentType });
        res.end(out.body);
        return;
      }

      const artworks = await getArtworks();
      const selected = pickRandom(artworks);
      const imageResponse = await fetch(selected.src, {
        headers: { accept: 'image/*,*/*;q=0.8' },
      });
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch artwork image: HTTP ${imageResponse.status}`);
      }

      const contentType = imageResponse.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      const id = randomUUID();
      artCache.set(id, {
        buffer: imageBuffer,
        contentType,
        item: selected,
        createdAt: Date.now(),
      });

      const out = jsonResponse({
        title: selected.title || 'Untitled',
        author: selected.author,
        twitter: selected.twitter || 'https://x.com/',
        source: 'ritualarts.xyz',
        imageUrl: `${baseUrl}/media/art/${id}.jpg`,
      });
      res.writeHead(out.status, { 'content-type': out.contentType, 'cache-control': 'no-store' });
      res.end(out.body);
      return;
    }

    if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/media/art/')) {
      const id = pathname.slice('/media/art/'.length).replace(/\.jpg$/i, '');
      const item = artCache.get(id);
      if (!item) {
        const out = jsonResponse({ error: 'Not found' }, 404);
        res.writeHead(out.status, { 'content-type': out.contentType });
        res.end(out.body);
        return;
      }

      writeBinaryResponse(
        method,
        res,
        200,
        {
          'content-type': item.contentType,
          'cache-control': 'public, max-age=86400, immutable',
        },
        item.buffer,
      );
      return;
    }

    const out = jsonResponse({ error: 'Not found' }, 404);
    res.writeHead(out.status, { 'content-type': out.contentType });
    res.end(out.body);
  } catch (error) {
    logger.error({ err: error }, 'Media server request failed');
    const out = jsonResponse({ error: 'Internal error' }, 500);
    res.writeHead(out.status, { 'content-type': out.contentType });
    res.end(out.body);
  }
});

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
server.listen(port, () => {
  logger.info({ port }, 'Ritty media server is online');
});
