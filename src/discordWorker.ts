import { setDefaultResultOrder } from 'node:dns';
import { appConfig } from './config.js';
import { logger } from './logger.js';
import { BotServices } from './services/botServices.js';
import { startDiscordBot } from './discordBot.js';
import { ingestRitualDocs } from './ai/ingest.js';
import { configureUndiciForRender } from './utils/networking.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logDiscordTokenStatusOnce(): Promise<void> {
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
        'Discord token preflight check succeeded',
      );
      return;
    }

    logger.error({ status: response.status }, 'Discord token preflight check failed');
  } catch (error) {
    logger.error({ err: error }, 'Discord token preflight request failed');
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

    logger.info({ utcDate }, 'Starting scheduled docs reindex (worker)');

    try {
      const result = await ingestRitualDocs({
        openai: services.openai,
        embeddingModel: appConfig.openai.embeddingModel,
        seedUrlsPath: appConfig.docsSeedUrlsPath,
        indexPath: appConfig.docsIndexPath,
        sourcesPath: appConfig.docsSourcesPath,
      });

      await services.loadDocsIndex();
      logger.info(result, 'Scheduled docs reindex completed (worker)');
    } catch (error) {
      logger.error({ err: error }, 'Scheduled docs reindex failed (worker)');
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
      const retryInMs = Math.min(120_000, 15_000 * attempt);
      logger.error({ err: error, attempt, retryInMs }, 'Discord startup failed, retrying');
      await sleep(retryInMs);
    }
  }
}

async function main(): Promise<void> {
  setDefaultResultOrder('ipv4first');
  logger.info('DNS result order set to ipv4first');
  configureUndiciForRender();
  logger.info('Discord worker booting');
  await logDiscordTokenStatusOnce();
  const services = new BotServices();
  logger.info('Bot services initialized');
  await services.loadDocsIndex();
  logger.info('Docs index loaded');

  scheduleDocsReindex(services);
  logger.info('Docs cron scheduled');
  await startDiscordWithRetry(services);
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal worker startup error');
  process.exit(1);
});
