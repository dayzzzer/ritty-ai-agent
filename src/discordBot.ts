import {
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

const DISCORD_READY_TIMEOUT_MS = 45_000;

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
  await message.reply({
    files: [{ attachment: greetingVideo.buffer, name: greetingVideo.name }],
  });
}

async function replyWithActionVideo(message: Message, action: RittyAction): Promise<void> {
  const actionVideo = await buildFileAttachmentFromPath(action.videoPath);
  await message.reply({
    files: [{ attachment: actionVideo.buffer, name: actionVideo.name }],
  });
}

async function replyWithAiAnswer(message: Message, services: BotServices, question: string): Promise<void> {
  const answer = await services.aiService.answerRitualQuestion(question, services.getDocsIndex());
  const citations = answer.citations.length > 0 ? `\n\nSources:\n${answer.citations.join('\n')}` : '';
  const fallbackImageUrl = answer.imageUrl ? `\n\n${answer.imageUrl}` : '';
  if (answer.imagePath) {
    try {
      const image = await buildImageAttachmentFromPath(answer.imagePath);
      await message.reply({
        content: `${answer.text}${citations}`.slice(0, 1900),
        files: [{ attachment: image.buffer, name: image.name }],
      });
      return;
    } catch (error) {
      logger.warn({ err: error, imagePath: answer.imagePath }, 'Failed to attach AI image in Discord reply');
    }
  }

  await message.reply(`${answer.text}${citations}${fallbackImageUrl}`.slice(0, 1900));
}

async function replyWithGreetingVideoAndAiAnswer(message: Message, services: BotServices, question: string): Promise<void> {
  const [greetingVideo, answer] = await Promise.all([
    buildFileAttachmentFromPath(appConfig.web.idleVideoPath),
    services.aiService.answerRitualQuestion(question, services.getDocsIndex()),
  ]);

  const citations = answer.citations.length > 0 ? `\n\nSources:\n${answer.citations.join('\n')}` : '';
  const fallbackImageUrl = !answer.imagePath && answer.imageUrl ? `\n\n${answer.imageUrl}` : '';
  const files: Array<{ attachment: Buffer; name: string }> = [
    { attachment: greetingVideo.buffer, name: greetingVideo.name },
  ];

  if (answer.imagePath) {
    try {
      const image = await buildImageAttachmentFromPath(answer.imagePath);
      files.push({ attachment: image.buffer, name: image.name });
    } catch (error) {
      logger.warn({ err: error, imagePath: answer.imagePath }, 'Failed to attach AI image in greeting reply');
    }
  }

  await message.reply({
    content: `${answer.text}${citations}${fallbackImageUrl}`.slice(0, 1900),
    files,
  });
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

async function waitForClientReady(client: Client, timeoutMs = DISCORD_READY_TIMEOUT_MS): Promise<void> {
  if (client.isReady()) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      client.off(Events.ClientReady, onReady);
      client.off(Events.Error, onError);
      reject(new Error(`Discord client did not reach ready state within ${timeoutMs}ms`));
    }, timeoutMs);

    const onReady = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      client.off(Events.ClientReady, onReady);
      client.off(Events.Error, onError);
      resolve();
    };

    const onError = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      client.off(Events.ClientReady, onReady);
      client.off(Events.Error, onError);
      reject(error);
    };

    client.on(Events.ClientReady, onReady);
    client.on(Events.Error, onError);
  });
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
        await interaction.followUp(toInteractionReplyOptions(payload));
        return;
      }
      if (interaction.deferred) {
        await interaction.editReply(toInteractionEditReplyOptions(payload));
        return;
      }
      await interaction.reply(toInteractionReplyOptions(payload));
    },
    followUp: async (payload: CommandResponse) => {
      await interaction.followUp(toInteractionReplyOptions(payload));
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
      await message.reply(toMessageOptions(payload) as MessageCreateOptions);
    },
    followUp: async (payload: CommandResponse) => {
      await message.reply(toMessageOptions(payload));
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

  client.once(Events.ClientReady, (readyClient) => {
    logger.info({ user: readyClient.user.tag }, 'RITTY AI is online');
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

      const isDm = message.channel.type === ChannelType.DM;
      const isMention = client.user ? message.mentions.has(client.user.id) : false;
      const shouldHandleAsAi = isDm || isMention;

      if (!shouldHandleAsAi) {
        return;
      }

      const now = Date.now();
      const previous = aiCooldown.get(message.author.id) ?? 0;
      if (now - previous < 5000) {
        await message.reply('Please wait a few seconds before your next AI request.');
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
            await message.reply('I got your question, but failed to generate an answer. Please retry once.');
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
    await client.login(appConfig.discord.token);
    await waitForClientReady(client);
  } catch (error) {
    client.destroy();
    throw error;
  }

  return client;
}
