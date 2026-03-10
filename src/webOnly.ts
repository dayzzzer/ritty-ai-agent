import { appConfig } from './config.js';
import { logger } from './logger.js';
import { BotServices } from './services/botServices.js';
import { ingestRitualDocs } from './ai/ingest.js';
import { startWebServer } from './web/server.js';

function scheduleDocsReindex(services: BotServices): void {
  if (!appConfig.docsCron.enabled) {
    return;
  }

  let lastRunDate = '';

  const runIfNeeded = async () => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcDate = now.toISOString().slice(0, 10);

    if (utcHour !== appConfig.docsCron.hourUtc || lastRunDate === utcDate) {
      return;
    }

    lastRunDate = utcDate;

    logger.info({ utcDate }, 'Starting scheduled docs reindex (web)');

    try {
      const result = await ingestRitualDocs({
        openai: services.openai,
        embeddingModel: appConfig.openai.embeddingModel,
        seedUrlsPath: appConfig.docsSeedUrlsPath,
        indexPath: appConfig.docsIndexPath,
        sourcesPath: appConfig.docsSourcesPath,
      });

      await services.loadDocsIndex();
      logger.info(result, 'Scheduled docs reindex completed (web)');
    } catch (error) {
      logger.error({ err: error }, 'Scheduled docs reindex failed (web)');
    }
  };

  setInterval(() => {
    void runIfNeeded();
  }, 10 * 60 * 1000);

  void runIfNeeded();
}

async function main(): Promise<void> {
  const services = new BotServices();
  await services.loadDocsIndex();

  startWebServer(services);
  scheduleDocsReindex(services);
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal web startup error');
  process.exit(1);
});
