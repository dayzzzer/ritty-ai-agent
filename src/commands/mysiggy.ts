import type { BotCommand } from './types.js';
import { buildImageAttachmentFromPath } from '../utils/imageAttachment.js';
import { buildSiggyCardEmbed, formatMeditationCompletion } from './siggyRpgShared.js';

export const mysiggyCommand: BotCommand = {
  name: 'mysiggy',
  description: 'Show your Siggy stats and rarity card',
  aliases: ['mysiggy'],
  async execute(ctx) {
    const result = await ctx.services.siggyRpgService.getSiggyCard(ctx.userId, ctx.username);
    if (!result) {
      await ctx.reply({
        content: 'No Siggy found. Use /newsiggy first.',
      });
      return;
    }

    const meditation = formatMeditationCompletion(result.meditationCompleted);

    try {
      const image = await buildImageAttachmentFromPath(result.card.imagePath);
      await ctx.reply({
        content: meditation || undefined,
        embeds: [buildSiggyCardEmbed(result.card)],
        files: [{ attachment: image.buffer, name: image.name }],
      });
    } catch {
      await ctx.reply({
        content: meditation || undefined,
        embeds: [buildSiggyCardEmbed(result.card)],
      });
    }
  },
};
