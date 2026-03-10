import type { BotCommand } from './types.js';
import { buildImageAttachmentFromPath } from '../utils/imageAttachment.js';
import { buildSiggyCardEmbed } from './siggyRpgShared.js';
import { logger } from '../logger.js';

export const newsiggyCommand: BotCommand = {
  name: 'newsiggy',
  description: 'Create your base Common Siggy',
  aliases: ['newsiggy'],
  async execute(ctx) {
    const result = await ctx.services.siggyRpgService.createSiggy(ctx.userId, ctx.username);
    const content = result.created
      ? 'Your Siggy has been created.'
      : 'You already have a Siggy. Showing your current profile.';

    try {
      const image = await buildImageAttachmentFromPath(result.card.imagePath);
      await ctx.reply({
        content,
        embeds: [buildSiggyCardEmbed(result.card)],
        files: [{ attachment: image.buffer, name: image.name }],
      });
    } catch (error) {
      logger.warn({ err: error }, 'Failed to send Siggy image attachment in /newsiggy');
      await ctx.reply({
        content: `${content}\n\nImage upload failed due a temporary Discord connection issue. Please retry.`,
        embeds: [buildSiggyCardEmbed(result.card)],
      });
    }
  },
};
