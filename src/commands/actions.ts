import type { BotCommand } from './types.js';
import { formatRittyActionsList } from '../actions/rittyActions.js';

export const actionsCommand: BotCommand = {
  name: 'actions',
  description: 'List available RITTY action videos',
  aliases: ['actions', 'rittyactions'],
  async execute(ctx) {
    await ctx.reply({
      content: formatRittyActionsList(),
    });
  },
};
