import { appConfig } from './config.js';
import { logger } from './logger.js';
import { BotServices } from './services/botServices.js';
import { startDiscordBot } from './discordBot.js';
import { ingestRitualDocs } from './ai/ingest.js';
import { startWebServer } from './web/server.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logDiscordApiDiagnostics(): Promise<number | null> {
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bot ${appConfig.discord.token}`,
      },
    });

    if (response.status === 200) {
      const payload = (await response.json()) as { id?: string; username?: string };
      logger.info(
        { status: response.status, botId: payload.id, botUsername: payload.username },
        'Discord API diagnostics succeeded',
      );
      return null;
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN;
      const retryAfterMs = Number.isFinite(retryAfterSeconds) ? Math.ceil(retryAfterSeconds * 1000) : null;
      logger.warn(
        { status: response.status, retryAfter, retryAfterMs },
        'Discord API diagnostics hit rate limit',
      );
      return retryAfterMs;
    }

    logger.error({ status: response.status }, 'Discord API diagnostics failed');
    return null;
  } catch (error) {
    logger.error({ err: error }, 'Discord API diagnostics request failed');
    return null;
  }
}

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

    logger.info({ utcDate }, 'Starting scheduled docs reindex');

    try {
      const result = await ingestRitualDocs({
        openai: services.openai,
        embeddingModel: appConfig.openai.embeddingModel,
        seedUrlsPath: appConfig.docsSeedUrlsPath,
        indexPath: appConfig.docsIndexPath,
        sourcesPath: appConfig.docsSourcesPath,
      });

      await services.loadDocsIndex();
      logger.info(result, 'Scheduled docs reindex completed');
    } catch (error) {
      logger.error({ err: error }, 'Scheduled docs reindex failed');
    }
  };

  setInterval(() => {
    void runIfNeeded();
  }, 10 * 60 * 1000);

  void runIfNeeded();
}

async function startDiscordWithRetry(services: BotServices): Promise<void> {
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      await startDiscordBot(services);
      logger.info({ attempt }, 'Discord bot startup completed');
      return;
    } catch (error) {
      let retryInMs = Math.min(120_000, 15_000 * attempt);
      const rateLimitRetryMs = await logDiscordApiDiagnostics();
      if (rateLimitRetryMs && rateLimitRetryMs > retryInMs) {
        retryInMs = Math.min(rateLimitRetryMs, 60 * 60 * 1000);
      }
      logger.error({ err: error, attempt, retryInMs }, 'Discord startup failed, retrying');
      await sleep(retryInMs);
    }
  }
}

async function main(): Promise<void> {
  const services = new BotServices();
  await services.loadDocsIndex();

  startWebServer(services);
  scheduleDocsReindex(services);
  await startDiscordWithRetry(services);
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal startup error');
  process.exit(1);
});
