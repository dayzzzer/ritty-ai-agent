import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
  type ButtonInteraction,
} from 'discord.js';
import type { BotCommand } from './types.js';
import { toRelativeTime } from './siggyRpgShared.js';
import type { BotServices } from '../services/botServices.js';
import { logger } from '../logger.js';
import type { SiggyDuelResult } from '../services/siggyRpgService.js';

const DUEL_CUSTOM_PREFIX = 'duel_accept';
const DUEL_RENDER_ROUNDS = 5;
const DUEL_ROUND_DELAY_MS = 1800;

interface DuelStage {
  tier: string;
  name: string;
  color: number;
}

const DUEL_STAGES: DuelStage[] = [
  { tier: 'TIER I', name: 'Signal Probe', color: 0x1f8b4c },
  { tier: 'TIER II', name: 'Resonance Clash', color: 0x2ea043 },
  { tier: 'TIER III', name: 'Anomaly Pressure', color: 0x3fb950 },
  { tier: 'TIER IV', name: 'Core Breach', color: 0xd29922 },
  { tier: 'TIER V', name: 'Final Burst', color: 0xcf222e },
];

const duelRenderInProgress = new Set<string>();
const duelRenderResolved = new Map<string, number>();

interface DuelRoundFrame {
  round: number;
  challengerHp: number;
  opponentHp: number;
  lineA: string;
  lineB: string;
}

function parseTargetId(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  const mentionMatch = trimmed.match(/^<@!?(\d{16,22})>$/);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  if (/^\d{16,22}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function buildAcceptCustomId(challengeId: string): string {
  return `${DUEL_CUSTOM_PREFIX}:${challengeId}`;
}

function parseAcceptCustomId(customId: string): string | null {
  const parts = customId.split(':');
  if (parts.length !== 2 || parts[0] !== DUEL_CUSTOM_PREFIX) {
    return null;
  }
  return parts[1] || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function cleanupResolvedTracker(now: number): void {
  const ttl = 30 * 60 * 1000;
  for (const [id, resolvedAt] of duelRenderResolved) {
    if (now - resolvedAt > ttl) {
      duelRenderResolved.delete(id);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function healthBar(value: number): string {
  const filled = Math.round(clamp(value, 0, 100) / 10);
  const empty = 10 - filled;
  return `[${'#'.repeat(filled)}${'-'.repeat(empty)}] ${Math.max(0, Math.round(value))}%`;
}

function getStage(round: number): DuelStage {
  return DUEL_STAGES[clamp(round, 1, DUEL_STAGES.length) - 1];
}

function buildChallengeEmbed(challengerId: string, targetId: string, expiresAt: number): APIEmbed {
  return {
    color: 0x1f8b4c,
    title: 'SIGGY DUEL // Challenge Issued',
    description: `<@${challengerId}> challenged <@${targetId}> to Siggy versus Siggy.`,
    fields: [
      {
        name: 'Expires',
        value: toRelativeTime(expiresAt),
        inline: true,
      },
      {
        name: 'Rules',
        value: 'Winner gains XP. Loser loses power, energy, and 20% XP.',
        inline: false,
      },
    ],
  };
}

function pickRoundAction(attacker: string, defender: string): string {
  const templates = [
    `${attacker} burst through a code-rift and struck ${defender}.`,
    `${attacker} launched a Resonance pulse into ${defender}'s guard.`,
    `${attacker} executed a sidecar feint and clipped ${defender}.`,
    `${attacker} injected anomaly packets at ${defender}'s flank.`,
    `${attacker} performed a matrix dash and pressured ${defender}.`,
    `${attacker} chained a cryptic combo on ${defender}.`,
  ];
  return templates[randomInt(0, templates.length - 1)];
}

function pickRoundCounter(attacker: string, defender: string): string {
  const templates = [
    `${defender} attempted a counter against ${attacker} and stabilized part of the damage.`,
    `${defender} rebalanced energy nodes while ${attacker} pressed forward.`,
    `${defender} blocked late but still took a hit from ${attacker}.`,
    `${defender} retaliated with a brief packet recoil on ${attacker}.`,
    `${defender} held formation and survived ${attacker}'s burst.`,
  ];
  return templates[randomInt(0, templates.length - 1)];
}

function buildBattleFrames(result: SiggyDuelResult): DuelRoundFrame[] {
  const challengerName = result.challenger.usernameSnapshot;
  const opponentName = result.opponent.usernameSnapshot;
  const challengerIsWinner = result.winnerUserId === result.challenger.userId;

  let challengerHp = 100;
  let opponentHp = 100;
  const frames: DuelRoundFrame[] = [];

  for (let round = 1; round <= DUEL_RENDER_ROUNDS; round += 1) {
    let dmgToChallenger = randomInt(8, 18);
    let dmgToOpponent = randomInt(8, 18);

    if (round < DUEL_RENDER_ROUNDS) {
      if (challengerIsWinner) {
        dmgToOpponent += randomInt(1, 6);
      } else {
        dmgToChallenger += randomInt(1, 6);
      }
    } else {
      if (challengerIsWinner) {
        const needed = challengerHp <= opponentHp ? opponentHp - challengerHp + randomInt(6, 14) : randomInt(12, 24);
        dmgToOpponent = clamp(needed, 10, opponentHp);
        dmgToChallenger = clamp(randomInt(4, 12), 0, Math.max(0, challengerHp - 1));
      } else {
        const needed = opponentHp <= challengerHp ? challengerHp - opponentHp + randomInt(6, 14) : randomInt(12, 24);
        dmgToChallenger = clamp(needed, 10, challengerHp);
        dmgToOpponent = clamp(randomInt(4, 12), 0, Math.max(0, opponentHp - 1));
      }
    }

    challengerHp = Math.max(0, challengerHp - dmgToChallenger);
    opponentHp = Math.max(0, opponentHp - dmgToOpponent);

    const challengerDominates = dmgToOpponent > dmgToChallenger;
    const lineA = challengerDominates
      ? pickRoundAction(challengerName, opponentName)
      : pickRoundAction(opponentName, challengerName);
    const lineB = challengerDominates
      ? pickRoundCounter(opponentName, challengerName)
      : pickRoundCounter(challengerName, opponentName);

    frames.push({
      round,
      challengerHp,
      opponentHp,
      lineA,
      lineB,
    });
  }

  return frames;
}

function buildRoundEmbed(
  result: SiggyDuelResult,
  frames: DuelRoundFrame[],
  currentRound: number,
): APIEmbed {
  const current = frames[currentRound - 1];
  const stage = getStage(currentRound);
  const history = frames
    .slice(Math.max(0, currentRound - 3), currentRound)
    .map((frame) => `R${frame.round}: ${frame.lineA}\n${frame.lineB}`)
    .join('\n\n');

  return {
    color: stage.color,
    title: `SIGGY DUEL // ${stage.tier}`,
    description: `${stage.name} // Round ${currentRound}/${DUEL_RENDER_ROUNDS}`,
    fields: [
      {
        name: 'Challenger HP',
        value: `<@${result.challenger.userId}>\n${healthBar(current.challengerHp)}`,
        inline: true,
      },
      {
        name: 'Opponent HP',
        value: `<@${result.opponent.userId}>\n${healthBar(current.opponentHp)}`,
        inline: true,
      },
      {
        name: 'Live Feed',
        value: history,
        inline: false,
      },
    ],
    footer: {
      text: `${stage.tier} broadcast active`,
    },
  };
}

function buildFinalEmbed(result: SiggyDuelResult, frames: DuelRoundFrame[]): APIEmbed {
  const finalFrame = frames[frames.length - 1];
  const winnerMention = `<@${result.winnerUserId}>`;
  const loserMention = `<@${result.loserUserId}>`;
  const challengerChance = Math.round(result.probabilityForChallenger * 100);
  const recap = frames.map((frame) => `R${frame.round}: ${frame.lineA}`).join('\n');

  return {
    color: 0x57f287,
    title: 'SIGGY DUEL // Final Verdict',
    description: `Winner locked: ${winnerMention}`,
    fields: [
      {
        name: 'Final HP',
        value: [
          `<@${result.challenger.userId}> ${healthBar(finalFrame.challengerHp)}`,
          `<@${result.opponent.userId}> ${healthBar(finalFrame.opponentHp)}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Rewards and Penalties',
        value: [
          `Winner: ${winnerMention} (+${result.winnerXpGain} XP)`,
          `Loser: ${loserMention} (-${result.loserXpLoss} XP, -${result.loserPowerLoss}% power, -${result.loserEnergyLoss}% energy)`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Pre-fight Challenger Win Chance',
        value: `${challengerChance}%`,
        inline: true,
      },
      {
        name: 'Round Recap',
        value: recap,
        inline: false,
      },
    ],
  };
}

async function duelExecute(ctx: Parameters<BotCommand['execute']>[0]): Promise<void> {
  const targetId = parseTargetId(ctx.args[0]);
  if (!targetId) {
    await ctx.reply({
      content: 'Usage: /rittyduel target:@user',
    });
    return;
  }

  try {
    const result = await ctx.services.siggyRpgService.createDuelChallenge(ctx.userId, ctx.username, targetId);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildAcceptCustomId(result.challenge.id))
        .setLabel('Accept Duel')
        .setStyle(ButtonStyle.Danger),
    );

    await ctx.reply({
      embeds: [buildChallengeEmbed(ctx.userId, targetId, result.challenge.expiresAt)],
      components: [row.toJSON()],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'NO_SIGGY') {
      await ctx.reply({ content: 'Both players must create a Siggy first with /newsiggy.' });
      return;
    }
    if (message === 'DUEL_SELF') {
      await ctx.reply({ content: 'You cannot duel yourself.' });
      return;
    }
    if (message === 'MEDITATING') {
      await ctx.reply({ content: 'Duel blocked: one of the Siggies is meditating.' });
      return;
    }
    if (message === 'DUEL_MISMATCH') {
      await ctx.reply({ content: 'Matchmaking blocked: level/rarity gap is too high.' });
      return;
    }
    if (message === 'DUEL_DAILY_LIMIT_CHALLENGER') {
      await ctx.reply({ content: 'You reached your duel daily limit (3/3). Resets at 00:00 UTC.' });
      return;
    }
    if (message === 'DUEL_DAILY_LIMIT_OPPONENT') {
      await ctx.reply({ content: 'Target user reached duel daily limit (3/3).' });
      return;
    }
    if (message === 'DUEL_COOLDOWN_CHALLENGER') {
      const profile = ctx.services.siggyRpgService.getProfileById(ctx.userId);
      await ctx.reply({
        content: profile ? `Your duel cooldown ends ${toRelativeTime(profile.cooldowns.duelReadyAt)}.` : 'You are on duel cooldown.',
      });
      return;
    }
    if (message === 'DUEL_COOLDOWN_OPPONENT') {
      const profile = ctx.services.siggyRpgService.getProfileById(targetId);
      await ctx.reply({
        content: profile ? `Target duel cooldown ends ${toRelativeTime(profile.cooldowns.duelReadyAt)}.` : 'Target is on duel cooldown.',
      });
      return;
    }
    throw error;
  }
}

const duelSlashOptions: BotCommand['slashOptions'] = [
  {
    name: 'target',
    description: 'User to challenge',
    required: true,
    type: 'user',
  },
];

export const rittyDuelCommand: BotCommand = {
  name: 'rittyduel',
  description: 'Start a Siggy duel challenge',
  aliases: ['rittyduel'],
  slashOptions: duelSlashOptions,
  execute: duelExecute,
};

export const svsCommand: BotCommand = {
  name: 'svs',
  description: 'Alias duel command (Siggy versus Siggy)',
  aliases: ['svs'],
  slashOptions: duelSlashOptions,
  execute: duelExecute,
};

export async function handleDuelButtonInteraction(
  interaction: ButtonInteraction,
  services: BotServices,
): Promise<boolean> {
  const challengeId = parseAcceptCustomId(interaction.customId);
  if (!challengeId) {
    return false;
  }

  cleanupResolvedTracker(Date.now());

  if (duelRenderResolved.has(challengeId)) {
    await interaction.reply({
      content: 'This duel is already resolved.',
      ephemeral: true,
    });
    return true;
  }

  if (duelRenderInProgress.has(challengeId)) {
    await interaction.reply({
      content: 'This duel is already in progress.',
      ephemeral: true,
    });
    return true;
  }

  duelRenderInProgress.add(challengeId);
  let interactionAcknowledged = false;

  try {
    const result = await services.siggyRpgService.resolveDuel(challengeId, interaction.user.id);
    const frames = buildBattleFrames(result);

    await interaction.update({
      content: '',
      embeds: [buildRoundEmbed(result, frames, 1)],
      components: [],
    });
    interactionAcknowledged = true;

    for (let round = 2; round <= DUEL_RENDER_ROUNDS; round += 1) {
      await interaction.editReply({
        content: '',
        embeds: [buildRoundEmbed(result, frames, round)],
      });
      await sleep(DUEL_ROUND_DELAY_MS);
    }

    await interaction.editReply({
      content: '',
      embeds: [buildFinalEmbed(result, frames)],
      components: [],
    });

    duelRenderResolved.set(challengeId, Date.now());
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (interactionAcknowledged) {
      logger.warn({ err: error, challengeId }, 'Duel render failed after interaction acknowledgment');
      try {
        await interaction.followUp({
          content: 'Battle feed interrupted, but duel state was applied. Use /mysiggy to inspect updated stats.',
        });
      } catch (followUpError) {
        logger.warn({ err: followUpError, challengeId }, 'Failed to send duel fallback follow-up');
      }
      return true;
    }

    if (message === 'DUEL_NOT_TARGET') {
      await interaction.reply({
        content: 'Only the challenged user can accept this duel.',
        ephemeral: true,
      });
      return true;
    }

    if (message === 'DUEL_CHALLENGE_EXPIRED' || message === 'DUEL_CHALLENGE_MISSING') {
      await interaction.update({
        content: 'Duel challenge expired.',
        components: [],
      });
      return true;
    }

    if (message === 'MEDITATING') {
      await interaction.update({
        content: 'Duel failed: one of the Siggies is meditating.',
        components: [],
      });
      return true;
    }

    if (message === 'DUEL_DAILY_LIMIT' || message === 'DUEL_COOLDOWN') {
      await interaction.update({
        content: 'Duel failed due to updated cooldown/daily limits.',
        components: [],
      });
      return true;
    }

    throw error;
  } finally {
    duelRenderInProgress.delete(challengeId);
  }
}
