import type { APIEmbed, MessageCreateOptions } from 'discord.js';
import type { SupportedLocale } from '../utils/language.js';
import type { BotServices } from '../services/botServices.js';

export interface CommandFile {
  attachment: Buffer;
  name: string;
}

export interface CommandResponse {
  content?: string;
  embeds?: APIEmbed[];
  files?: CommandFile[];
  components?: MessageCreateOptions['components'];
  ephemeral?: boolean;
}

export interface CommandContext {
  args: string[];
  locale: SupportedLocale;
  userId: string;
  username: string;
  channelId: string;
  services: BotServices;
  reply: (payload: CommandResponse) => Promise<void>;
  followUp: (payload: CommandResponse) => Promise<void>;
}

export interface BotCommand {
  name: string;
  description: string;
  aliases: string[];
  deferReply?: boolean;
  slashOptions?: Array<{
    name: string;
    description: string;
    required?: boolean;
    type: 'string' | 'user';
  }>;
  execute: (ctx: CommandContext) => Promise<void>;
}

export function toMessageOptions(payload: CommandResponse): MessageCreateOptions {
  return {
    content: payload.content,
    embeds: payload.embeds,
    files: payload.files?.map((file) => ({ attachment: file.attachment, name: file.name })),
    components: payload.components,
  };
}
