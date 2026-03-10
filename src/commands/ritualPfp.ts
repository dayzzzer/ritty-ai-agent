import type { BotCommand } from './types.js';
import { localize } from '../utils/language.js';
import { logger } from '../logger.js';

export const ritualPfpCommand: BotCommand = {
  name: 'ritualpfp',
  description: 'Generate a random Ritual profile picture',
  aliases: ['ritualpfp'],
  async execute(ctx) {
    const generated = await ctx.services.pfpService.generateRandomPfp();

    const traits = generated.selected.map((entry) => `• ${entry.layer}: ${entry.name}`).join('\n');

    const content = localize(ctx.locale, 'Твой случайный Ritual PFP готов.', 'Your random Ritual PFP is ready.');
    const embeds = [
      {
        title: localize(ctx.locale, 'Выбранные трейты', 'Selected Traits'),
        description: traits || localize(ctx.locale, 'Нет выбранных трейтов', 'No traits selected'),
      },
    ];

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await ctx.reply({
          content,
          files: [
            {
              attachment: generated.buffer,
              name: `ritty-pfp-${Date.now()}.jpg`,
            },
          ],
          embeds,
        });
        return;
      } catch (error) {
        logger.warn({ err: error, attempt }, 'Failed to send generated PFP attachment in /ritualpfp');
        if (attempt < 5) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
      }
    }

    await ctx.reply({
      content: `${content}\n\nImage upload failed due a temporary Discord connection issue. Please retry.`,
      embeds,
    });
  },
};
