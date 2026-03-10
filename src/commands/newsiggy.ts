import type { BotCommand } from './types.js';
import { buildImageAttachmentFromPath } from '../utils/imageAttachment.js';
import { buildSiggyCardEmbed } from './siggyRpgShared.js';

export const newsiggyCommand: BotCommand = {
  name: 'newsiggy',
  description: 'Create your base Common Siggy',
  aliases: ['newsiggy'],
  async execute(ctx) {
    const result = await ctx.services.siggyRpgService.createSiggy(ctx.userId, ctx.username);
    try {
      const image = await buildImageAttachmentFromPath(result.card.imagePath);
      await ctx.reply({
        content: result.created
          ? 'Your Siggy has been created.'
          : 'You already have a Siggy. Showing your current profile.',
        embeds: [buildSiggyCardEmbed(result.card)],
        files: [{ attachment: image.buffer, name: image.name }],
      });
    } catch {
      await ctx.reply({
        content: result.created
          ? 'Your Siggy has been created.'
          : 'You already have a Siggy. Showing your current profile.',
        embeds: [buildSiggyCardEmbed(result.card)],
      });
    }
  },
};
