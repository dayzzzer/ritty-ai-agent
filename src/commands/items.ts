import type { BotCommand } from './types.js';
import { formatMeditationCompletion } from './siggyRpgShared.js';

export const itemsCommand: BotCommand = {
  name: 'items',
  description: 'Show your Siggy inventory',
  aliases: ['items'],
  async execute(ctx) {
    try {
      const result = await ctx.services.siggyRpgService.getItems(ctx.userId, ctx.username);
      const inv = result.profile.inventory;
      const lines = [
        `Mystic Fish: ${inv.mysticFish}`,
        `Epic Mystic Fish: ${inv.epicMysticFish}`,
        `Mega Mystic Fish: ${inv.megaMysticFish}`,
        `Void Ritual Milk: ${inv.voidRitualMilk}`,
      ];

      const meditation = formatMeditationCompletion(result.meditationCompleted);
      await ctx.reply({
        content: [meditation, 'Inventory:', ...lines].filter(Boolean).join('\n'),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_SIGGY') {
        await ctx.reply({ content: 'No Siggy found. Use /newsiggy first.' });
        return;
      }
      throw error;
    }
  },
};
