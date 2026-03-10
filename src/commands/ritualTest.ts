import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import type { BotCommand, CommandResponse } from './types.js';
import type { QuizQuestion, QuizSession } from '../services/types.js';
import { localize, type SupportedLocale } from '../utils/language.js';
import type { BotServices } from '../services/botServices.js';

const QUIZ_PREFIX = 'quiz';

function buildQuizCustomId(sessionId: string, userId: string, locale: SupportedLocale, optionIndex: number): string {
  return `${QUIZ_PREFIX}:${sessionId}:${userId}:${locale}:${optionIndex}`;
}

function parseQuizCustomId(customId: string): {
  sessionId: string;
  userId: string;
  locale: SupportedLocale;
  optionIndex: number;
} | null {
  const parts = customId.split(':');
  if (parts.length !== 5 || parts[0] !== QUIZ_PREFIX) {
    return null;
  }

  const optionIndex = Number.parseInt(parts[4], 10);
  if (!Number.isInteger(optionIndex) || optionIndex < 0) {
    return null;
  }

  const locale = parts[3] === 'ru' ? 'ru' : 'en';

  return {
    sessionId: parts[1],
    userId: parts[2],
    locale,
    optionIndex,
  };
}

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function createQuestionEmbed(session: QuizSession, locale: SupportedLocale, feedback?: string): APIEmbed {
  const question = session.questions[session.currentIndex];
  const questionText = locale === 'ru' ? question.questionRu || question.question : question.question;

  const options = question.options.map((option, index) => `**${optionLetter(index)}.** ${option}`).join('\n');

  const header = localize(locale, `Вопрос ${session.currentIndex + 1} из ${session.questions.length}`, `Question ${session.currentIndex + 1} of ${session.questions.length}`);

  const lines = [questionText, '', options];
  if (feedback) {
    lines.unshift(feedback, '');
  }

  return {
    title: localize(locale, 'Ritual Test', 'Ritual Test'),
    fields: [
      { name: header, value: lines.join('\n') },
      {
        name: localize(locale, 'Текущий счет', 'Current score'),
        value: `${session.score}/${session.questions.length}`,
      },
    ],
  };
}

function createQuestionComponents(session: QuizSession, locale: SupportedLocale) {
  const question = session.questions[session.currentIndex];
  const row = new ActionRowBuilder<ButtonBuilder>();

  question.options.forEach((option, index) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildQuizCustomId(session.id, session.userId, locale, index))
        .setLabel(`${optionLetter(index)}. ${option.slice(0, 70)}`)
        .setStyle(ButtonStyle.Secondary),
    );
  });

  return [row.toJSON()] as CommandResponse['components'];
}

function buildFinishedEmbed(session: QuizSession, locale: SupportedLocale, lastQuestion: QuizQuestion, isCorrect: boolean): APIEmbed {
  const scoreText = `${session.score}/${session.questions.length}`;
  const verdict =
    session.score >= 4
      ? localize(locale, 'Отличный результат', 'Great score')
      : session.score >= 2
        ? localize(locale, 'Хороший старт', 'Good start')
        : localize(locale, 'Можно улучшить', 'Needs improvement');

  return {
    title: localize(locale, 'Ritual Test завершен', 'Ritual Test complete'),
    description: [
      isCorrect
        ? localize(locale, 'Последний ответ: верно.', 'Last answer: correct.')
        : localize(locale, 'Последний ответ: неверно.', 'Last answer: incorrect.'),
      localize(locale, `Правильный вариант: ${optionLetter(lastQuestion.correctIndex)}`, `Correct option: ${optionLetter(lastQuestion.correctIndex)}`),
      localize(locale, `Пояснение: ${lastQuestion.explanation}`, `Explanation: ${lastQuestion.explanation}`),
      '',
      `${localize(locale, 'Итог', 'Final score')}: **${scoreText}**`,
      `${localize(locale, 'Оценка', 'Result')}: **${verdict}**`,
    ].join('\n'),
  };
}

function buildReplyForActiveSession(session: QuizSession, locale: SupportedLocale, feedback?: string): CommandResponse {
  return {
    embeds: [createQuestionEmbed(session, locale, feedback)],
    components: createQuestionComponents(session, locale),
  };
}

export const ritualTestCommand: BotCommand = {
  name: 'ritualtest',
  description: 'Start a short Ritual knowledge quiz',
  aliases: ['ritualtest'],
  async execute(ctx) {
    ctx.services.quizService.clearSession(ctx.userId);
    const session = await ctx.services.quizService.createSession(ctx.userId);

    await ctx.reply(buildReplyForActiveSession(session, ctx.locale));
  },
};

export async function handleQuizButtonInteraction(
  interaction: ButtonInteraction,
  services: BotServices,
): Promise<boolean> {
  const parsed = parseQuizCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  if (interaction.user.id !== parsed.userId) {
    await interaction.reply({
      content:
        parsed.locale === 'ru'
          ? 'Этот тест запущен для другого пользователя.'
          : 'This quiz belongs to another user.',
      ephemeral: true,
    });
    return true;
  }

  const active = services.quizService.getSession(parsed.userId);

  if (!active || active.id !== parsed.sessionId) {
    await interaction.reply({
      content:
        parsed.locale === 'ru'
          ? 'Сессия теста истекла. Запусти /ritualtest заново.'
          : 'Quiz session expired. Start /ritualtest again.',
      ephemeral: true,
    });
    return true;
  }

  const result = services.quizService.answerCurrentQuestion(parsed.userId, parsed.optionIndex);

  const feedback = result.isCorrect
    ? localize(parsed.locale, 'Верно.', 'Correct.')
    : `${localize(parsed.locale, 'Неверно.', 'Incorrect.')} ${localize(parsed.locale, 'Правильный ответ', 'Correct answer')}: ${optionLetter(result.question.correctIndex)}. ${result.question.options[result.question.correctIndex]}\n${localize(parsed.locale, 'Пояснение', 'Explanation')}: ${result.question.explanation}`;

  if (result.finished) {
    await interaction.update({
      embeds: [buildFinishedEmbed(result.session, parsed.locale, result.question, result.isCorrect)],
      components: [],
      content: null,
    });

    return true;
  }

  await interaction.update({
    embeds: [createQuestionEmbed(result.session, parsed.locale, feedback)],
    components: createQuestionComponents(result.session, parsed.locale),
    content: null,
  });

  return true;
}

export async function handlePrefixQuizAnswer(
  message: Message,
  services: BotServices,
): Promise<boolean> {
  const session = services.quizService.getSession(message.author.id);
  if (!session) {
    return false;
  }

  const trimmed = message.content.trim().toUpperCase();
  const optionIndex = trimmed.charCodeAt(0) - 65;

  if (optionIndex < 0 || Number.isNaN(optionIndex)) {
    return false;
  }

  const locale: SupportedLocale = /[\u0400-\u04FF]/.test(message.content) ? 'ru' : 'en';

  const currentQuestion = session.questions[session.currentIndex];
  if (optionIndex >= currentQuestion.options.length) {
    return false;
  }

  const result = services.quizService.answerCurrentQuestion(message.author.id, optionIndex);

  const feedback = result.isCorrect
    ? localize(locale, 'Верно.', 'Correct.')
    : `${localize(locale, 'Неверно.', 'Incorrect.')} ${localize(locale, 'Правильный ответ', 'Correct answer')}: ${optionLetter(result.question.correctIndex)}. ${result.question.options[result.question.correctIndex]}\n${localize(locale, 'Пояснение', 'Explanation')}: ${result.question.explanation}`;

  if (result.finished) {
    await message.reply({
      embeds: [buildFinishedEmbed(result.session, locale, result.question, result.isCorrect)],
    });
    return true;
  }

  await message.reply(buildReplyForActiveSession(result.session, locale, feedback));
  return true;
}
