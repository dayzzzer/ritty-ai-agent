import type { BotCommand } from './types.js';
import { formatMeditationCompletion, toRelativeTime } from './siggyRpgShared.js';

export const siggyMeditateCommand: BotCommand = {
  name: 'siggymeditate',
  description: 'Start Siggy meditation to gain XP knowledge boost',
  aliases: ['siggymeditate'],
  async execute(ctx) {
    try {
      const result = await ctx.services.siggyRpgService.startMeditation(ctx.userId, ctx.username);
      const completion = formatMeditationCompletion(result.meditationCompleted);
      await ctx.reply({
        content: [
          completion,
          'Siggy entered meditation mode.',
          `Meditation ends: ${toRelativeTime(result.endsAt)}`,
          'During meditation Siggy cannot run quest, fishing, or duel.',
        ]
          .filter(Boolean)
          .join('\n'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'NO_SIGGY') {
        await ctx.reply({ content: 'No Siggy found. Use /newsiggy first.' });
        return;
      }
      if (message === 'MEDITATING') {
        const profile = ctx.services.siggyRpgService.getProfileById(ctx.userId);
        const endsAt = profile?.meditation?.endsAt;
        await ctx.reply({
          content: endsAt
            ? `Siggy is already meditating. Ends: ${toRelativeTime(endsAt)}`
            : 'Siggy is already meditating.',
        });
        return;
      }
      throw error;
    }
  },
};
