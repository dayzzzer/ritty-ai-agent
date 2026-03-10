import type { BotCommand } from './types.js';
import { localize } from '../utils/language.js';

export const ritualRandomCommand: BotCommand = {
  name: 'ritualrandom',
  description: 'Return a random short technical Ritual fact',
  aliases: ['ritualrandom'],
  async execute(ctx) {
    const fact = await ctx.services.factService.getRandomFact();

    await ctx.reply({
      embeds: [
        {
          title: localize(ctx.locale, 'Случайный факт о Ritual', 'Random Ritual Fact'),
          description: fact.text,
          fields: [
            {
              name: localize(ctx.locale, 'Источник', 'Source'),
              value: fact.source,
            },
          ],
        },
      ],
    });
  },
};
