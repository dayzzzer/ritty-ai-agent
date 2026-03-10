import type { BotCommand } from './types.js';
import { localize } from '../utils/language.js';

export const artRitualCommand: BotCommand = {
  name: 'artritual',
  description: 'Show a random Ritual community artwork',
  aliases: ['artritual'],
  async execute(ctx) {
    try {
      const art = await ctx.services.artService.getRandomArtwork();

      await ctx.reply({
        embeds: [
          {
            title: localize(ctx.locale, 'Случайный Ritual арт', 'Random Ritual Artwork'),
            description: `**${art.title || 'Untitled'}**\nAuthor: [${art.author}](${art.twitter || 'https://x.com/'})`,
            image: { url: art.src },
            footer: {
              text: localize(ctx.locale, 'Источник: ritualarts.xyz', 'Source: ritualarts.xyz'),
            },
          },
        ],
      });
    } catch (error) {
      await ctx.reply({
        content: localize(
          ctx.locale,
          'Не получилось загрузить арт сейчас. Попробуй еще раз через минуту.',
          'Could not load artwork right now. Please try again in a minute.',
        ),
      });

      throw error;
    }
  },
};
