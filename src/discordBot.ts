import {
  type APIEmbed,
  ChannelType,
  Client,
  DiscordAPIError,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type Message,
  type MessageCreateOptions,
  MessageFlags,
} from 'discord.js';
import { appConfig } from './config.js';
import { logger } from './logger.js';
import { commands, resolveCommand } from './commands/index.js';
import type { BotCommand, CommandResponse } from './commands/types.js';
import { toMessageOptions } from './commands/types.js';
import { detectLocaleFromText, type SupportedLocale } from './utils/language.js';
import { BotServices } from './services/botServices.js';
import { handlePrefixQuizAnswer, handleQuizButtonInteraction } from './commands/ritualTest.js';
import { handleDuelButtonInteraction } from './commands/rittyDuel.js';
import { buildFileAttachmentFromPath, buildImageAttachmentFromPath } from './utils/imageAttachment.js';
import { detectRittyActionFromText, type RittyAction } from './actions/rittyActions.js';

const GREETING_WORDS = new Set([
  'hi',
  'hello',
  'hey',
  'yo',
  'sup',
  'greetings',
  'gm',
  'good',
  'morning',
  'afternoon',
  'evening',
  'night',
  'привет',
  'здравствуй',
  'здравствуйте',
  'хай',
  'здорово',
  'доброе',
  'добрый',
  'утро',
  'день',
  'вечер',
  'hola',
  'bonjour',
  'hallo',
  'ciao',
  'ola',
  'olá',
  'hej',
  'salut',
  'namaste',
  'مرحبا',
  'สวัสดี',
  'こんにちは',
  'こんばんは',
  '안녕',
  '你好',
  '哈喽',
]);

const GREETING_IGNORED_WORDS = new Set([
  ...GREETING_WORDS,
  'ritty',
  'siggy',
  'ai',
  'bot',
  'please',
  'pls',
  'пожалуйста',
  'эй',
  'heyy',
  'helo',
  'helloooo',
]);
const RITTY_NAME_PATTERN = /\b(ritty|siggy|сигги|сиги|ритти)\b/iu;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableDiscordError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: string | number; message?: string };
  const code = typeof candidate.code === 'string' ? candidate.code : String(candidate.code ?? '');
  const message = (candidate.message ?? '').toLowerCase();

  return (
    code === 'UND_ERR_SOCKET' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    message.includes('other side closed') ||
    message.includes('socket') ||
    message.includes('network')
  );
}

async function withDiscordRetry<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 4;
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetriableDiscordError(error)) {
        throw error;
      }

      const retryDelay = 250 * attempt;
      logger.warn({ err: error, attempt, operationName, retryDelay }, 'Retrying Discord API operation after transient error');
      await sleep(retryDelay);
    }
  }
}

function normalizeForIntent(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGreetingIntent(input: string): boolean {
  const normalized = normalizeForIntent(input);
  if (!normalized) {
    return false;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  return tokens.some((token) => GREETING_WORDS.has(token));
}

function stripGreetingTokens(input: string): string {
  const originalTokens = input.trim().split(/\s+/g).filter(Boolean);
  if (originalTokens.length === 0) {
    return '';
  }

  const cleaned = originalTokens.filter((token) => {
    const normalized = token
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '')
      .trim();
    if (!normalized) {
      return false;
    }
    return !GREETING_IGNORED_WORDS.has(normalized);
  });

  return cleaned.join(' ').trim();
}

async function replyWithGreetingVideo(message: Message): Promise<void> {
  const greetingVideo = await buildFileAttachmentFromPath(appConfig.web.idleVideoPath);
  await withDiscordRetry('message.reply.greetingVideo', () =>
    message.reply({
      files: [{ attachment: greetingVideo.buffer, name: greetingVideo.name }],
    }),
  );
}

async function replyWithActionVideo(message: Message, action: RittyAction): Promise<void> {
  const actionVideo = await buildFileAttachmentFromPath(action.videoPath);
  await withDiscordRetry(`message.reply.actionVideo.${action.id}`, () =>
    message.reply({
      files: [{ attachment: actionVideo.buffer, name: actionVideo.name }],
    }),
  );
}

async function replyWithAiAnswer(message: Message, services: BotServices, question: string): Promise<void> {
  const answer = await services.aiService.answerRitualQuestion(question, services.getDocsIndex());
  const sourcesValue = answer.citations.map((url, index) => `${index + 1}. ${url}`).join('\n');
  const trimmedDescription = answer.text.length > 3900 ? `${answer.text.slice(0, 3897)}...` : answer.text;
  const baseEmbed: APIEmbed = {
    title: 'RITTY AI Answer',
    description: trimmedDescription,
    fields:
      sourcesValue.length > 0
        ? [
            {
              name: 'Sources',
              value: sourcesValue.slice(0, 1024),
            },
          ]
        : undefined,
    footer: {
      text: answer.usedRag ? 'Grounded on indexed docs' : 'General AI answer',
    },
  };

  if (answer.imagePath) {
    try {
      const image = await buildImageAttachmentFromPath(answer.imagePath);
      await withDiscordRetry('message.reply.aiAnswer.attachmentImage', () =>
        message.reply({
          embeds: [{ ...baseEmbed, image: { url: `attachment://${image.name}` } }],
          files: [{ attachment: image.buffer, name: image.name }],
        }),
      );
      return;
    } catch (error) {
      logger.warn({ err: error, imagePath: answer.imagePath }, 'Failed to attach AI image in Discord reply');
    }
  }

  const remoteImageUrl = answer.imageUrl;
  if (remoteImageUrl) {
    await withDiscordRetry('message.reply.aiAnswer.remoteImage', () =>
      message.reply({
        embeds: [{ ...baseEmbed, image: { url: remoteImageUrl } }],
      }),
    );
    return;
  }

  const citations = answer.citations.length > 0 ? `\n\nSources:\n${answer.citations.join('\n')}` : '';
  await withDiscordRetry('message.reply.aiAnswer.textOnly', () => message.reply(`${answer.text}${citations}`.slice(0, 1900)));
}

async function replyWithGreetingVideoAndAiAnswer(message: Message, services: BotServices, question: string): Promise<void> {
  const [greetingVideo, answer] = await Promise.all([
    buildFileAttachmentFromPath(appConfig.web.idleVideoPath),
    services.aiService.answerRitualQuestion(question, services.getDocsIndex()),
  ]);

  const sourcesValue = answer.citations.map((url, index) => `${index + 1}. ${url}`).join('\n');
  const trimmedDescription = answer.text.length > 3900 ? `${answer.text.slice(0, 3897)}...` : answer.text;
  const embed: APIEmbed = {
    title: 'RITTY AI Answer',
    description: trimmedDescription,
    fields:
      sourcesValue.length > 0
        ? [
            {
              name: 'Sources',
              value: sourcesValue.slice(0, 1024),
            },
          ]
        : undefined,
    footer: {
      text: answer.usedRag ? 'Grounded on indexed docs' : 'General AI answer',
    },
  };

  const files: Array<{ attachment: Buffer; name: string }> = [
    { attachment: greetingVideo.buffer, name: greetingVideo.name },
  ];

  let imageEmbedUrl: string | undefined;
  if (answer.imagePath) {
    try {
      const image = await buildImageAttachmentFromPath(answer.imagePath);
      files.push({ attachment: image.buffer, name: image.name });
      imageEmbedUrl = `attachment://${image.name}`;
    } catch (error) {
      logger.warn({ err: error, imagePath: answer.imagePath }, 'Failed to attach AI image in greeting reply');
    }
  }

  if (!imageEmbedUrl && answer.imageUrl) {
    imageEmbedUrl = answer.imageUrl;
  }

  await withDiscordRetry('message.reply.greetingAndAnswer', () =>
    message.reply({
      embeds: [{ ...embed, image: imageEmbedUrl ? { url: imageEmbedUrl } : undefined }],
      files,
    }),
  );
}

function toInteractionReplyOptions(payload: CommandResponse): InteractionReplyOptions {
  return {
    content: payload.content,
    embeds: payload.embeds,
    files: payload.files?.map((file) => ({ attachment: file.attachment, name: file.name })),
    components: payload.components,
    flags: payload.ephemeral ? MessageFlags.Ephemeral : undefined,
  };
}

function toInteractionEditReplyOptions(payload: CommandResponse): InteractionEditReplyOptions {
  return {
    content: payload.content,
    embeds: payload.embeds,
    files: payload.files?.map((file) => ({ attachment: file.attachment, name: file.name })),
    components: payload.components,
  };
}

function extractSlashArgs(interaction: ChatInputCommandInteraction, command: BotCommand): string[] {
  if (!command.slashOptions || command.slashOptions.length === 0) {
    return [];
  }

  const args: string[] = [];
  for (const option of command.slashOptions) {
    if (option.type === 'string') {
      const value = interaction.options.getString(option.name, Boolean(option.required));
      if (value) {
        args.push(value);
      }
      continue;
    }

    if (option.type === 'user') {
      const value = interaction.options.getUser(option.name, Boolean(option.required));
      if (value) {
        args.push(value.id);
      }
    }
  }

  return args;
}

async function executeSlashCommand(
  interaction: ChatInputCommandInteraction,
  command: BotCommand,
  services: BotServices,
): Promise<void> {
  const locale: SupportedLocale = 'en';
  const shouldDefer = command.deferReply ?? true;

  if (shouldDefer && !interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  const ctx = {
    args: extractSlashArgs(interaction, command),
    locale,
    userId: interaction.user.id,
    username: interaction.user.username,
    channelId: interaction.channelId,
    services,
    reply: async (payload: CommandResponse) => {
      if (interaction.replied) {
        await withDiscordRetry('interaction.followUp.reply', () => interaction.followUp(toInteractionReplyOptions(payload)));
        return;
      }
      if (interaction.deferred) {
        await withDiscordRetry('interaction.editReply.reply', () => interaction.editReply(toInteractionEditReplyOptions(payload)));
        return;
      }
      await withDiscordRetry('interaction.reply.reply', () => interaction.reply(toInteractionReplyOptions(payload)));
    },
    followUp: async (payload: CommandResponse) => {
      await withDiscordRetry('interaction.followUp.followUp', () => interaction.followUp(toInteractionReplyOptions(payload)));
    },
  };

  await command.execute(ctx);
}

async function executePrefixCommand(message: Message, command: BotCommand, args: string[], services: BotServices): Promise<void> {
  const locale: SupportedLocale = detectLocaleFromText(message.content);

  const ctx = {
    args,
    locale,
    userId: message.author.id,
    username: message.author.username,
    channelId: message.channelId,
    services,
    reply: async (payload: CommandResponse) => {
      await withDiscordRetry('message.reply.prefix.reply', () => message.reply(toMessageOptions(payload) as MessageCreateOptions));
    },
    followUp: async (payload: CommandResponse) => {
      await withDiscordRetry('message.reply.prefix.followUp', () => message.reply(toMessageOptions(payload)));
    },
  };

  await command.execute(ctx);
}

export async function registerSlashCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(appConfig.discord.token);

  const slashPayload = commands.map((command) => ({
    name: command.name,
    description: command.description,
    options:
      command.slashOptions?.map((option) => ({
        type: option.type === 'user' ? 6 : 3,
        name: option.name,
        description: option.description,
        required: option.required ?? false,
      })) ?? [],
  }));

  if (appConfig.discord.guildId) {
    await rest.put(Routes.applicationGuildCommands(appConfig.discord.clientId, appConfig.discord.guildId), {
      body: slashPayload,
    });
    logger.info({ guildId: appConfig.discord.guildId, count: slashPayload.length }, 'Registered guild slash commands');
    return;
  }

  await rest.put(Routes.applicationCommands(appConfig.discord.clientId), { body: slashPayload });
  logger.info({ count: slashPayload.length }, 'Registered global slash commands');
}

export async function startDiscordBot(services: BotServices): Promise<Client> {
  logger.info('Initializing Discord client');
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
    rest: {
      timeout: 60_000,
    },
  });

  const aiCooldown = new Map<string, number>();
  const handledMessageIds = new Map<string, number>();

  client.once(Events.ClientReady, (readyClient) => {
    logger.info({ user: readyClient.user.tag }, 'RITTY AI is online');
  });
  client.on(Events.ShardReady, (shardId) => {
    logger.info({ shardId }, 'Discord shard is ready');
  });
  client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    logger.warn(
      { shardId, code: closeEvent.code, reason: closeEvent.reason, wasClean: closeEvent.wasClean },
      'Discord shard disconnected',
    );
  });
  client.on(Events.ShardError, (error, shardId) => {
    logger.error({ err: error, shardId }, 'Discord shard error');
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton()) {
        const duelHandled = await handleDuelButtonInteraction(interaction, services);
        if (duelHandled) {
          return;
        }

        const handled = await handleQuizButtonInteraction(interaction, services);
        if (handled) {
          return;
        }
      }

      if (!interaction.isChatInputCommand()) {
        return;
      }

      const command = resolveCommand(interaction.commandName);
      if (!command) {
        await interaction.reply({ content: 'Unknown command.', ephemeral: true });
        return;
      }

      await executeSlashCommand(interaction, command, services);
    } catch (error) {
      if (error instanceof DiscordAPIError && (error.code === 10062 || error.code === 40060)) {
        logger.warn({ err: error, code: error.code }, 'Interaction was already acknowledged elsewhere');
        return;
      }

      logger.error({ err: error }, 'Interaction handling failed');
      if (interaction.isRepliable()) {
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Something went wrong. Please try again.', flags: MessageFlags.Ephemeral });
          } else if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: 'Something went wrong. Please try again.' });
          } else {
            await interaction.followUp({ content: 'Something went wrong. Please try again.', flags: MessageFlags.Ephemeral });
          }
        } catch (replyError) {
          logger.warn({ err: replyError }, 'Failed to send interaction error response');
        }
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author.bot) {
        return;
      }

      const now = Date.now();
      if (handledMessageIds.has(message.id)) {
        return;
      }
      handledMessageIds.set(message.id, now);
      if (handledMessageIds.size > 2000) {
        const expiration = now - 10 * 60 * 1000;
        for (const [id, ts] of handledMessageIds) {
          if (ts < expiration) {
            handledMessageIds.delete(id);
          }
        }
      }

      if (await handlePrefixQuizAnswer(message, services)) {
        return;
      }

      const content = message.content.trim();
      if (content.startsWith(appConfig.discord.prefix)) {
        const withoutPrefix = content.slice(appConfig.discord.prefix.length).trim();
        if (!withoutPrefix) {
          return;
        }

        const [name, ...args] = withoutPrefix.split(/\s+/g);
        const command = resolveCommand(name);
        if (!command) {
          return;
        }

        await executePrefixCommand(message, command, args, services);
        return;
      }

      const publicAction = detectRittyActionFromText(content);
      if (publicAction && RITTY_NAME_PATTERN.test(content)) {
        await replyWithActionVideo(message, publicAction);
        return;
      }

      const isDm = message.channel.type === ChannelType.DM;
      const isMention = client.user ? message.mentions.has(client.user.id) : false;
      const shouldHandleAsAi = isDm || isMention;

      if (!shouldHandleAsAi) {
        return;
      }

      const previous = aiCooldown.get(message.author.id) ?? 0;
      if (now - previous < 5000) {
        await withDiscordRetry('message.reply.cooldown', () => message.reply('Please wait a few seconds before your next AI request.'));
        return;
      }
      aiCooldown.set(message.author.id, now);

      const cleanedQuestion = content
        .replace(new RegExp(`<@!?${client.user?.id}>`, 'g'), '')
        .trim();

      if (isGreetingIntent(cleanedQuestion || content)) {
        const questionAfterGreeting = stripGreetingTokens(cleanedQuestion);

        if (!questionAfterGreeting) {
          await replyWithGreetingVideo(message);
          return;
        }

        const greetingAction = detectRittyActionFromText(questionAfterGreeting);
        if (greetingAction) {
          await replyWithActionVideo(message, greetingAction);
          return;
        }

        try {
          await replyWithGreetingVideoAndAiAnswer(message, services, questionAfterGreeting);
        } catch {
          try {
            await replyWithAiAnswer(message, services, questionAfterGreeting);
          } catch {
            await withDiscordRetry('message.reply.aiFallback', () =>
              message.reply('I got your question, but failed to generate an answer. Please retry once.'),
            );
          }
        }
        return;
      }

      if (!cleanedQuestion) {
        return;
      }

      const requestedAction = detectRittyActionFromText(cleanedQuestion);
      if (requestedAction) {
        await replyWithActionVideo(message, requestedAction);
        return;
      }

      await replyWithAiAnswer(message, services, cleanedQuestion);
    } catch (error) {
      logger.error({ err: error }, 'Message handling failed');
    }
  });

  try {
    logger.info('Starting Discord login');
    const loginWatchdog = setTimeout(() => {
      logger.error('Discord login is still pending after 60s');
    }, 60_000);

    await client.login(appConfig.discord.token);
    clearTimeout(loginWatchdog);
    logger.info('Discord login resolved');
  } catch (error) {
    client.destroy();
    throw error;
  }

  return client;
}
