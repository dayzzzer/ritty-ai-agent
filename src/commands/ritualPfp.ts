import type { BotCommand } from './types.js';
import { localize } from '../utils/language.js';

export const ritualPfpCommand: BotCommand = {
  name: 'ritualpfp',
  description: 'Generate a random Ritual profile picture',
  aliases: ['ritualpfp'],
  async execute(ctx) {
    const generated = await ctx.services.pfpService.generateRandomPfp();

    const traits = generated.selected.map((entry) => `• ${entry.layer}: ${entry.name}`).join('\n');

    await ctx.reply({
      content: localize(ctx.locale, 'Твой случайный Ritual PFP готов.', 'Your random Ritual PFP is ready.'),
      files: [
        {
          attachment: generated.buffer,
          name: `ritty-pfp-${Date.now()}.png`,
        },
      ],
      embeds: [
        {
          title: localize(ctx.locale, 'Выбранные трейты', 'Selected Traits'),
          description: traits || localize(ctx.locale, 'Нет выбранных трейтов', 'No traits selected'),
        },
      ],
    });
  },
};
