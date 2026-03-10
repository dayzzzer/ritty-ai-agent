import type { BotCommand } from './types.js';
import { formatMeditationCompletion, toRelativeTime } from './siggyRpgShared.js';

export const questCommand: BotCommand = {
  name: 'quest',
  description: 'Send your Siggy to a quest for XP and rewards',
  aliases: ['quest'],
  async execute(ctx) {
    try {
      const result = await ctx.services.siggyRpgService.runQuest(ctx.userId, ctx.username);
      const parts = [
        formatMeditationCompletion(result.meditationCompleted),
        `Quest report: ${result.line}`,
        `XP gained: +${result.xpGained}${result.boosted ? ' (XP buff applied)' : ''}`,
        `Reward: +${result.gainedMilk} Void Ritual Milk`,
        `Quests left today: ${result.questsLeftToday}/${ctx.services.siggyRpgService.getQuestDailyLimit()}`,
        `Next quest available: ${toRelativeTime(result.nextQuestAt)}`,
      ].filter(Boolean);

      await ctx.reply({
        content: parts.join('\n'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'NO_SIGGY') {
        await ctx.reply({ content: 'No Siggy found. Use /newsiggy first.' });
        return;
      }
      if (message === 'MEDITATING') {
        await ctx.reply({ content: 'Siggy is meditating and cannot run quests right now.' });
        return;
      }
      if (message === 'QUEST_DAILY_LIMIT') {
        await ctx.reply({ content: 'Quest daily limit reached (2/2). Resets at 00:00 UTC.' });
        return;
      }
      if (message === 'QUEST_COOLDOWN') {
        const profile = ctx.services.siggyRpgService.getProfileById(ctx.userId);
        await ctx.reply({
          content: profile
            ? `Quest is on cooldown. Next quest: ${toRelativeTime(profile.cooldowns.questReadyAt)}`
            : 'Quest is on cooldown.',
        });
        return;
      }
      throw error;
    }
  },
};
