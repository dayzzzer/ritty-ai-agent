import type { BotCommand } from './types.js';
import { localize } from '../utils/language.js';
import { appConfig } from '../config.js';
import { logger } from '../logger.js';

export const artRitualCommand: BotCommand = {
  name: 'artritual',
  description: 'Show a random Ritual community artwork',
  aliases: ['artritual'],
  deferReply: true,
  async execute(ctx) {
    try {
      if (appConfig.mediaBaseUrl) {
        try {
          const response = await fetch(`${appConfig.mediaBaseUrl}/api/art/random`, {
            headers: { accept: 'application/json' },
          });
          if (!response.ok) {
            throw new Error(`Media API returned ${response.status}`);
          }

          const payload = (await response.json()) as {
            title: string;
            author: string;
            twitter?: string;
            source?: string;
            imageUrl: string;
          };

          await ctx.reply({
            embeds: [
              {
                title: localize(ctx.locale, 'Случайный Ritual арт', 'Random Ritual Artwork'),
                description: `**${payload.title || 'Untitled'}**\nAuthor: [${payload.author}](${payload.twitter || 'https://x.com/'})`,
                image: { url: payload.imageUrl },
                footer: {
                  text: localize(ctx.locale, `Источник: ${payload.source || 'ritualarts.xyz'}`, `Source: ${payload.source || 'ritualarts.xyz'}`),
                },
              },
            ],
          });
          return;
        } catch (error) {
          logger.warn({ err: error }, 'Media API artrittual fallback to art service');
        }
      }

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
