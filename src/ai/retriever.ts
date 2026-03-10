import OpenAI from 'openai';
import { cosineSimilarity, type DocsChunk, type DocsIndex } from './docsIndex.js';

export interface RetrievedChunk {
  chunk: DocsChunk;
  score: number;
}

export class RitualRetriever {
  constructor(
    private readonly openai: OpenAI,
    private readonly embeddingModel: string,
  ) {}

  async retrieve(query: string, index: DocsIndex, topK = 4): Promise<RetrievedChunk[]> {
    if (!query.trim() || index.chunks.length === 0) {
      return [];
    }

    const embeddingResponse = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: query,
    });

    const queryEmbedding = embeddingResponse.data[0]?.embedding;
    if (!queryEmbedding) {
      return [];
    }

    return index.chunks
      .map((chunk) => ({
        chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .filter((result) => Number.isFinite(result.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
