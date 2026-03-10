import { createServer } from 'node:http';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { appConfig } from './config.js';
import { logger } from './logger.js';
import { PfpService } from './services/pfpService.js';

interface CachedPfp {
  buffer: Buffer;
  selected: Array<{ layer: string; id: string; name: string }>;
  createdAt: number;
}

const pfpService = new PfpService(appConfig.pfpAssetsRoot);
const pfpCache = new Map<string, CachedPfp>();
const CACHE_TTL_MS = 10 * 60 * 1000;

const siggyImageByRarity: Record<string, string> = {
  common: appConfig.siggyRpg.rarityImages.Common,
  rare: appConfig.siggyRpg.rarityImages.Rare,
  epic: appConfig.siggyRpg.rarityImages.Epic,
  legendary: appConfig.siggyRpg.rarityImages.Legendary,
  forbidden: appConfig.siggyRpg.rarityImages.Forbidden,
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
    if (now - item.createdAt > CACHE_TTL_MS) {
      pfpCache.delete(id);
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
  if (appConfig.mediaPublicBaseUrl) {
    return appConfig.mediaPublicBaseUrl;
  }
  if (!hostHeader) {
    return null;
  }
  return `https://${hostHeader}`;
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

    if (method === 'GET' && pathname.startsWith('/media/siggy/')) {
      const rarity = pathname.slice('/media/siggy/'.length).toLowerCase();
      const imagePath = siggyImageByRarity[rarity];
      if (!imagePath) {
        const out = jsonResponse({ error: 'Unknown rarity' }, 404);
        res.writeHead(out.status, { 'content-type': out.contentType });
        res.end(out.body);
        return;
      }

      const image = await readFile(imagePath);
      res.writeHead(200, {
        'content-type': getMimeByPath(imagePath),
        'cache-control': 'public, max-age=3600',
      });
      res.end(image);
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

    if (method === 'GET' && pathname.startsWith('/media/pfp/')) {
      const id = pathname.slice('/media/pfp/'.length).replace(/\.jpg$/i, '');
      const item = pfpCache.get(id);
      if (!item) {
        const out = jsonResponse({ error: 'Not found' }, 404);
        res.writeHead(out.status, { 'content-type': out.contentType });
        res.end(out.body);
        return;
      }

      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=300',
      });
      res.end(item.buffer);
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
