import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';
import OpenAI from 'openai';
import { chunkText, saveDocsIndex, saveDocsSources, type DocsChunk, type DocsSourceRecord } from './docsIndex.js';
import { logger } from '../logger.js';

export interface IngestDocsParams {
  openai: OpenAI;
  embeddingModel: string;
  seedUrlsPath: string;
  indexPath: string;
  sourcesPath: string;
  maxPages?: number;
}

interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  links: string[];
}

const DEFAULT_MAX_PAGES = 25;
const ALLOWED_HOSTS = new Set(['ritualfoundation.org', 'www.ritualfoundation.org', 'ritual.net', 'www.ritual.net']);

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.toString();
}

function shouldCrawl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return false;
    }

    if (parsed.hostname.includes('ritualfoundation.org')) {
      return parsed.pathname.startsWith('/docs');
    }

    return parsed.pathname === '/' || parsed.pathname.startsWith('/docs');
  } catch {
    return false;
  }
}

async function fetchPage(url: string): Promise<PageSnapshot | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'RITTY-AI-Indexer/1.0',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'Skipping page due to non-OK response');
      return null;
    }

    const html = await response.text();
    const $ = load(html);

    $('script, style, noscript, iframe').remove();

    const title = $('title').first().text().trim() || 'Untitled';
    const bodyText = $('main').text().trim() || $('article').text().trim() || $('body').text().trim();

    const links = new Set<string>();
    $('a[href]').each((_idx, el) => {
      const href = $(el).attr('href');
      if (!href) {
        return;
      }

      try {
        const absolute = normalizeUrl(new URL(href, url).toString());
        if (shouldCrawl(absolute)) {
          links.add(absolute);
        }
      } catch {
        // ignore malformed links
      }
    });

    const text = bodyText.replace(/\s+/g, ' ').trim();
    if (!text) {
      return null;
    }

    return {
      url,
      title,
      text,
      links: [...links],
    };
  } catch (error) {
    logger.warn({ err: error, url }, 'Failed to fetch page');
    return null;
  }
}

async function embedChunks(openai: OpenAI, embeddingModel: string, chunks: Array<Omit<DocsChunk, 'embedding'>>): Promise<DocsChunk[]> {
  const embedded: DocsChunk[] = [];

  for (const chunk of chunks) {
    const embeddingResponse = await openai.embeddings.create({
      model: embeddingModel,
      input: chunk.text,
    });

    const vector = embeddingResponse.data[0]?.embedding;
    if (!vector) {
      continue;
    }

    embedded.push({
      ...chunk,
      embedding: vector,
    });
  }

  return embedded;
}

export async function ingestRitualDocs(params: IngestDocsParams): Promise<{ pages: number; chunks: number }> {
  const seedRaw = await readFile(params.seedUrlsPath, 'utf8');
  const seeds = JSON.parse(seedRaw) as string[];

  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES;
  const queue: string[] = [];
  const visited = new Set<string>();

  for (const seed of seeds) {
    try {
      const normalized = normalizeUrl(seed);
      if (shouldCrawl(normalized)) {
        queue.push(normalized);
      }
    } catch {
      logger.warn({ seed }, 'Skipping invalid seed URL');
    }
  }

  const pageSnapshots: PageSnapshot[] = [];

  while (queue.length > 0 && pageSnapshots.length < maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    const snapshot = await fetchPage(current);
    if (!snapshot) {
      continue;
    }

    pageSnapshots.push(snapshot);

    for (const next of snapshot.links) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  const chunkInputs: Array<Omit<DocsChunk, 'embedding'>> = [];

  for (const page of pageSnapshots) {
    const chunks = chunkText(page.text, 1200, 150);
    for (let index = 0; index < chunks.length; index += 1) {
      const text = chunks[index];
      chunkInputs.push({
        id: crypto.createHash('sha256').update(`${page.url}|${index}|${text}`).digest('hex').slice(0, 20),
        sourceUrl: page.url,
        title: page.title,
        text,
      });
    }
  }

  const embeddedChunks = await embedChunks(params.openai, params.embeddingModel, chunkInputs);

  await saveDocsIndex(params.indexPath, {
    generatedAt: new Date().toISOString(),
    embeddingModel: params.embeddingModel,
    chunks: embeddedChunks,
  });

  const sources: DocsSourceRecord[] = pageSnapshots.map((page) => ({
    url: page.url,
    title: page.title,
    crawledAt: new Date().toISOString(),
  }));

  await saveDocsSources(params.sourcesPath, sources);

  return {
    pages: pageSnapshots.length,
    chunks: embeddedChunks.length,
  };
}
