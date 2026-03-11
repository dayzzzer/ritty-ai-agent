import path from 'node:path';
import type { BotCommand } from './types.js';
import { localize } from '../utils/language.js';
import { buildFileAttachmentFromPath, buildImageAttachmentFromPath } from '../utils/imageAttachment.js';
import { logger } from '../logger.js';
import { detectRittyActionFromText } from '../actions/rittyActions.js';
import { appConfig } from '../config.js';

export const askRittyCommand: BotCommand = {
  name: 'askritty',
  description: 'Ask RITTY AI a question about Ritual',
  aliases: ['askritty', 'ask'],
  slashOptions: [
    {
      name: 'question',
      description: 'Your question about Ritual',
      required: true,
      type: 'string',
    },
  ],
  async execute(ctx) {
    const question = ctx.args.join(' ').trim();
    if (!question) {
      await ctx.reply({
        content: localize(
          ctx.locale,
          'Напиши вопрос после команды, например: !askRitty What is Ritual?',
          'Provide a question after the command, for example: !askRitty What is Ritual?',
        ),
      });
      return;
    }

    const requestedAction = detectRittyActionFromText(question);
    if (requestedAction) {
      if (appConfig.mediaBaseUrl) {
        await ctx.reply({
          content: `${appConfig.mediaBaseUrl}/media/action/${encodeURIComponent(requestedAction.id)}.mp4`,
        });
        return;
      }

      try {
        const video = await buildFileAttachmentFromPath(requestedAction.videoPath);
        await ctx.reply({
          files: [{ attachment: video.buffer, name: video.name }],
        });
        return;
      } catch (error) {
        logger.warn({ err: error, actionId: requestedAction.id }, 'Failed to attach askRitty action video');
        if (appConfig.mediaBaseUrl) {
          await ctx.reply({
            content: `${appConfig.mediaBaseUrl}/media/action/${encodeURIComponent(requestedAction.id)}.mp4`,
          });
          return;
        }
      }
    }

    const index = ctx.services.getDocsIndex();
    const answer = await ctx.services.aiService.answerRitualQuestion(question, index);
    const fields =
      answer.citations.length > 0
        ? [
            {
              name: localize(ctx.locale, 'Источники', 'Sources'),
              value: answer.citations.map((url, indexItem) => `${indexItem + 1}. ${url}`).join('\n'),
            },
          ]
        : [];

    const fallbackImageUrl =
      answer.imageUrl ??
      (answer.imagePath && path.basename(answer.imagePath).toLowerCase() === 'ritual-chain.svg' && appConfig.mediaBaseUrl
        ? `${appConfig.mediaBaseUrl}/media/what-is-ritual.svg`
        : undefined);
    const files: Array<{ attachment: Buffer; name: string }> = [];
    let attachedImageName: string | null = null;

    if (!fallbackImageUrl && answer.imagePath) {
      try {
        const image = await buildImageAttachmentFromPath(answer.imagePath);
        attachedImageName = image.name;
        files.push({
          attachment: image.buffer,
          name: image.name,
        });
      } catch (error) {
        logger.warn({ err: error, imagePath: answer.imagePath }, 'Failed to attach askRitty image');
      }
    }

    await ctx.reply({
      embeds: [
        {
          title: localize(ctx.locale, 'Ответ RITTY AI', 'RITTY AI Answer'),
          description: answer.text,
          fields,
          image: attachedImageName
            ? { url: `attachment://${attachedImageName}` }
            : fallbackImageUrl
              ? { url: fallbackImageUrl }
              : undefined,
          footer: {
            text: answer.usedRag
              ? localize(ctx.locale, 'Ответ на основе индекса docs', 'Grounded on indexed docs')
              : localize(ctx.locale, 'Общий ответ ИИ без docs-источников', 'General AI answer without docs citations'),
          },
        },
      ],
      files: files.length > 0 ? files : undefined,
    });
  },
};
