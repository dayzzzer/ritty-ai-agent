import type { BotCommand } from './types.js';
import { formatMeditationCompletion } from './siggyRpgShared.js';

export const fishingCommand: BotCommand = {
  name: 'fishing',
  description: 'Go fishing in code and collect Mystic fish',
  aliases: ['fishing'],
  async execute(ctx) {
    try {
      const result = await ctx.services.siggyRpgService.runFishing(ctx.userId, ctx.username);
      await ctx.reply({
        content: [
          formatMeditationCompletion(result.meditationCompleted),
          `Fishing complete: you caught **${result.fishLabel}**.`,
          `XP gained: +${result.xpGained}`,
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
      if (message === 'MEDITATING') {
        await ctx.reply({ content: 'Siggy is meditating and cannot fish right now.' });
        return;
      }
      throw error;
    }
  },
};
