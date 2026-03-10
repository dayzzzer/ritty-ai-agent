import type { BotCommand } from './types.js';
import { localize } from '../utils/language.js';

export const teamCommand: BotCommand = {
  name: 'team',
  description: 'Show Ritual team members with links and roles',
  aliases: ['team'],
  async execute(ctx) {
    const members = await ctx.services.teamService.getTeamMembers();

    const lines = members.map((member) => `• [${member.name}](${member.twitter}) — **${member.role}**\n${member.description}`);

    await ctx.reply({
      embeds: [
        {
          title: localize(ctx.locale, 'Команда Ritual', 'Ritual Team'),
          description: lines.join('\n\n') || localize(ctx.locale, 'Список пока пуст.', 'Team list is empty.'),
        },
      ],
    });
  },
};
