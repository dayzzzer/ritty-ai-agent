import OpenAI from 'openai';
import { appConfig } from './src/config.ts';
import { AiService } from './src/ai/aiService.ts';
import { loadDocsIndex } from './src/ai/docsIndex.ts';

(async () => {
  const openai = new OpenAI({ apiKey: appConfig.openai.apiKey });
  const svc = new AiService(openai, appConfig.openai.model, appConfig.openai.embeddingModel, appConfig.whatIsRitualImagePath);
  const index = await loadDocsIndex(appConfig.docsIndexPath);
  const q = 'так вес слона то какой брат';
  const r = await svc.answerRitualQuestion(q, index);
  console.log('text:', r.text.slice(0, 500));
  console.log('citations:', r.citations.length);
})();
