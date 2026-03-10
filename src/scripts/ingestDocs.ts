import OpenAI from 'openai';
import { appConfig } from '../config.js';
import { ingestRitualDocs } from '../ai/ingest.js';
import { logger } from '../logger.js';

const openai = new OpenAI({ apiKey: appConfig.openai.apiKey });

ingestRitualDocs({
  openai,
  embeddingModel: appConfig.openai.embeddingModel,
  seedUrlsPath: appConfig.docsSeedUrlsPath,
  indexPath: appConfig.docsIndexPath,
  sourcesPath: appConfig.docsSourcesPath,
})
  .then((result) => {
    logger.info(result, 'Ritual docs indexing finished');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ err: error }, 'Ritual docs indexing failed');
    process.exit(1);
  });
