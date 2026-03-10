import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface DocsChunk {
  id: string;
  sourceUrl: string;
  title: string;
  text: string;
  embedding: number[];
}

export interface DocsIndex {
  generatedAt: string;
  embeddingModel: string;
  chunks: DocsChunk[];
}

export interface DocsSourceRecord {
  url: string;
  title: string;
  crawledAt: string;
}

export async function loadDocsIndex(filePath: string): Promise<DocsIndex | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as DocsIndex;
  } catch {
    return null;
  }
}

export async function saveDocsIndex(filePath: string, index: DocsIndex): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(index, null, 2), 'utf8');
}

export async function saveDocsSources(filePath: string, sources: DocsSourceRecord[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(sources, null, 2), 'utf8');
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return -1;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return -1;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function chunkText(input: string, chunkSize = 1200, overlap = 150): string[] {
  const sanitized = input.replace(/\s+/g, ' ').trim();
  if (!sanitized) {
    return [];
  }

  const chunks: string[] = [];
  let pointer = 0;

  while (pointer < sanitized.length) {
    const end = Math.min(pointer + chunkSize, sanitized.length);
    const chunk = sanitized.slice(pointer, end).trim();

    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (end === sanitized.length) {
      break;
    }

    pointer = Math.max(end - overlap, pointer + 1);
  }

  return chunks;
}
