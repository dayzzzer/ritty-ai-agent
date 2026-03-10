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
    const embed = buildSiggyCardEmbed(result.card);
    let image: Awaited<ReturnType<typeof buildImageAttachmentFromPath>>;

    try {
      image = await buildImageAttachmentFromPath(result.card.imagePath);
    } catch (error) {
      logger.warn({ err: error }, 'Failed to prepare Siggy image attachment in /newsiggy');
      await ctx.reply({
        content: `${content}\n\nImage generation failed. Please retry.`,
        embeds: [embed],
      });
      return;
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await ctx.reply({
          content,
          embeds: [embed],
          files: [{ attachment: image.buffer, name: image.name }],
        });
        return;
      } catch (error) {
        logger.warn({ err: error, attempt }, 'Failed to send Siggy image attachment in /newsiggy');
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
      }
    }

    await ctx.reply({
      content: `${content}\n\nImage upload failed due a temporary Discord connection issue. Please retry.`,
      embeds: [embed],
    });
  },
};
