import type { BotCommand } from './types.js';
import { formatMeditationCompletion, humanItemName, parseFeedItem } from './siggyRpgShared.js';

const FEED_USAGE = 'Usage: /feed item:<mystic|epic|mega|milk>';

export const feedCommand: BotCommand = {
  name: 'feed',
  description: 'Feed Siggy using fish or milk from inventory',
  aliases: ['feed'],
  slashOptions: [
    {
      name: 'item',
      description: 'mystic | epic | mega | milk',
      required: true,
      type: 'string',
    },
  ],
  async execute(ctx) {
    const rawItem = ctx.args[0] ?? '';
    const item = parseFeedItem(rawItem);
    if (!item) {
      await ctx.reply({ content: FEED_USAGE });
      return;
    }

    try {
      const result = await ctx.services.siggyRpgService.feed(ctx.userId, ctx.username, item);
      await ctx.reply({
        content: [
          formatMeditationCompletion(result.meditationCompleted),
          `Siggy consumed ${humanItemName(result.item)}.`,
          `Power increased: +${result.powerAdded}%`,
          `Energy increased: +${result.energyAdded}%`,
          `Current stats: Power ${result.profile.power}% | Energy ${result.profile.energyCurrent}%`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'NO_SIGGY') {
        await ctx.reply({ content: 'No Siggy found. Use /newsiggy first.' });
        return;
      }
      if (message === 'NO_ITEM') {
        await ctx.reply({ content: `You do not have ${humanItemName(item)} in inventory.` });
        return;
      }
      throw error;
    }
  },
};
