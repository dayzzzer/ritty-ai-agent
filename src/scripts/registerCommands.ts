import { registerSlashCommands } from '../discordBot.js';
import { logger } from '../logger.js';

registerSlashCommands()
  .then(() => {
    logger.info('Slash command registration completed.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ err: error }, 'Slash command registration failed');
    process.exit(1);
  });
