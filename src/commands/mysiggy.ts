import type { BotCommand } from './types.js';
import { buildImageAttachmentFromPath } from '../utils/imageAttachment.js';
import { buildSiggyCardEmbed, formatMeditationCompletion } from './siggyRpgShared.js';
import { logger } from '../logger.js';

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
    const embed = buildSiggyCardEmbed(result.card);
    let image: Awaited<ReturnType<typeof buildImageAttachmentFromPath>>;

    try {
      image = await buildImageAttachmentFromPath(result.card.imagePath);
    } catch (error) {
      logger.warn({ err: error }, 'Failed to prepare Siggy image attachment in /mysiggy');
      await ctx.reply({
        content: meditation
          ? `${meditation}\n\nImage generation failed. Please retry.`
          : 'Image generation failed. Please retry.',
        embeds: [embed],
      });
      return;
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await ctx.reply({
          content: meditation || undefined,
          embeds: [embed],
          files: [{ attachment: image.buffer, name: image.name }],
        });
        return;
      } catch (error) {
        logger.warn({ err: error, attempt }, 'Failed to send Siggy image attachment in /mysiggy');
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
      }
    }

    await ctx.reply({
      content: meditation
        ? `${meditation}\n\nImage upload failed due a temporary Discord connection issue. Please retry.`
        : 'Image upload failed due a temporary Discord connection issue. Please retry.',
      embeds: [embed],
    });
  },
};
