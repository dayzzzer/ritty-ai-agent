import type { BotCommand } from './types.js';
import { localize } from '../utils/language.js';
import { buildImageAttachmentFromPath } from '../utils/imageAttachment.js';
import { logger } from '../logger.js';

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

    const files = [];
    if (answer.imagePath) {
      try {
        const image = await buildImageAttachmentFromPath(answer.imagePath);
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
          image: answer.imageUrl ? { url: answer.imageUrl } : undefined,
          footer: {
            text: answer.usedRag
              ? localize(ctx.locale, 'Ответ на основе индекса docs', 'Grounded on indexed docs')
              : localize(ctx.locale, 'Общий ответ ИИ без docs-источников', 'General AI answer without docs citations'),
          },
        },
      ],
      files,
    });
  },
};
