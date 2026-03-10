import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { logger } from '../logger.js';
import type {
  DuelChallenge,
  FeedItemType,
  FishDropType,
  SiggyInventory,
  SiggyProfile,
  SiggyRarity,
  SiggyRpgState,
} from './siggyRpgTypes.js';

const QUEST_DAILY_LIMIT = 2;
const DUEL_DAILY_LIMIT = 3;

const QUEST_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const DUEL_COOLDOWN_MS = 3 * 60 * 60 * 1000;

const MEDITATION_DURATION_MS = 30 * 60 * 1000;
const XP_BUFF_DURATION_MS = 15 * 60 * 1000;
const DUEL_CHALLENGE_TTL_MS = 3 * 60 * 1000;

const RARITY_ORDER: SiggyRarity[] = ['Common', 'Rare', 'Epic', 'Legendary', 'Forbidden'];
const RARITY_BONUS: Record<SiggyRarity, number> = {
  Common: 0,
  Rare: 4,
  Epic: 8,
  Legendary: 12,
  Forbidden: 16,
};

const QUEST_LINES = [
  'Siggy traced unstable opcode echoes in a broken shard.',
  'Siggy synchronized a failing sidecar with a Resonance pulse.',
  'Siggy sealed a memory leak inside the anomaly corridor.',
  'Siggy recovered corrupted AI sigils from deep matrix fog.',
  'Siggy rerouted hostile packets away from Ritual core.',
];

const FISH_LABEL: Record<FishDropType, string> = {
  mysticFish: 'Mystic Fish',
  epicMysticFish: 'Epic Mystic Fish',
  megaMysticFish: 'Mega Mystic Fish',
};

export interface SiggyRpgImagePaths {
  Common: string;
  Rare: string;
  Epic: string;
  Legendary: string;
  Forbidden: string;
}

export interface SiggyStatCard {
  title: string;
  owner: string;
  level: number;
  rarity: SiggyRarity;
  xp: number;
  power: number;
  energy: number;
  energyMax: number;
  imagePath: string;
}

export interface SiggyQuestResult {
  profile: SiggyProfile;
  line: string;
  xpGained: number;
  gainedMilk: number;
  boosted: boolean;
  questsLeftToday: number;
  nextQuestAt: number;
  meditationCompleted?: {
    xpFromMeditation: number;
    buffUntil: number;
  };
}

export interface SiggyMeditationStartResult {
  profile: SiggyProfile;
  endsAt: number;
  meditationCompleted?: {
    xpFromMeditation: number;
    buffUntil: number;
  };
}

export interface SiggyFishingResult {
  profile: SiggyProfile;
  fish: FishDropType;
  fishLabel: string;
  xpGained: number;
  meditationCompleted?: {
    xpFromMeditation: number;
    buffUntil: number;
  };
}

export interface SiggyFeedResult {
  profile: SiggyProfile;
  item: FeedItemType;
  powerAdded: number;
  energyAdded: number;
  meditationCompleted?: {
    xpFromMeditation: number;
    buffUntil: number;
  };
}

export interface SiggyDuelChallengeResult {
  challenge: DuelChallenge;
  challenger: SiggyProfile;
  opponent: SiggyProfile;
  meditationCompletedChallenger?: {
    xpFromMeditation: number;
    buffUntil: number;
  };
}

export interface SiggyDuelResult {
  challenge: DuelChallenge;
  winnerUserId: string;
  loserUserId: string;
  winnerXpGain: number;
  loserXpLoss: number;
  loserPowerLoss: number;
  loserEnergyLoss: number;
  probabilityForChallenger: number;
  challenger: SiggyProfile;
  opponent: SiggyProfile;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function nowUtcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function pickQuestLine(): string {
  return QUEST_LINES[Math.floor(Math.random() * QUEST_LINES.length)];
}

function emptyInventory(): SiggyInventory {
  return {
    mysticFish: 0,
    epicMysticFish: 0,
    megaMysticFish: 0,
    voidRitualMilk: 0,
  };
}

function rarityFromLevel(level: number): SiggyRarity {
  if (level >= 50) return 'Forbidden';
  if (level >= 35) return 'Legendary';
  if (level >= 20) return 'Epic';
  if (level >= 10) return 'Rare';
  return 'Common';
}

function rarityRank(rarity: SiggyRarity): number {
  return RARITY_ORDER.indexOf(rarity);
}

function cloneProfile(profile: SiggyProfile): SiggyProfile {
  return {
    ...profile,
    inventory: { ...profile.inventory },
    cooldowns: { ...profile.cooldowns },
    daily: { ...profile.daily },
    meditation: profile.meditation ? { ...profile.meditation } : null,
  };
}

export class SiggyRpgService {
  private state: SiggyRpgState = { profiles: {} };
  private loaded = false;
  private persistChain: Promise<void> = Promise.resolve();
  private readonly duelChallenges = new Map<string, DuelChallenge>();

  constructor(
    private readonly statePath: string,
    private readonly rarityImages: SiggyRpgImagePaths,
  ) {}

  private profilesCount(): number {
    return Object.keys(this.state.profiles).length;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      const raw = await readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SiggyRpgState>;
      this.state = {
        profiles: parsed.profiles ?? {},
      };
      logger.info(
        { statePath: this.statePath, profiles: this.profilesCount() },
        'SiggyRpg state loaded',
      );
    } catch {
      this.state = { profiles: {} };
      logger.warn({ statePath: this.statePath }, 'SiggyRpg state file missing or invalid, starting empty');
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify(this.state, null, 2);
    const dir = path.dirname(this.statePath);
    const tmpPath = `${this.statePath}.tmp`;

    this.persistChain = this.persistChain.then(async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(tmpPath, payload, 'utf8');
      await rename(tmpPath, this.statePath);
      logger.info(
        { statePath: this.statePath, profiles: this.profilesCount() },
        'SiggyRpg state persisted',
      );
    });

    await this.persistChain;
  }

  private resolveDaily(profile: SiggyProfile, now: number): void {
    const dayKey = nowUtcDayKey(now);
    if (profile.daily.dayKeyUtc !== dayKey) {
      profile.daily.dayKeyUtc = dayKey;
      profile.daily.questsUsed = 0;
      profile.daily.duelsUsed = 0;
    }
  }

  private applyLevelAndRarity(profile: SiggyProfile): void {
    const targetLevel = Math.floor(profile.xp / 100) + 1;
    if (targetLevel > profile.level) {
      profile.level = targetLevel;
    }

    const targetRarity = rarityFromLevel(profile.level);
    if (rarityRank(targetRarity) > rarityRank(profile.rarity)) {
      profile.rarity = targetRarity;
    }
  }

  private settleMeditation(profile: SiggyProfile, now: number): {
    changed: boolean;
    completed?: {
      xpFromMeditation: number;
      buffUntil: number;
    };
  } {
    if (!profile.meditation || now < profile.meditation.endsAt) {
      return { changed: false };
    }

    const bonusXp = Math.ceil(profile.xp * 0.15);
    profile.xp += bonusXp;
    profile.activeXpBuffUntil = now + XP_BUFF_DURATION_MS;
    profile.meditation = null;
    this.applyLevelAndRarity(profile);

    return {
      changed: true,
      completed: {
        xpFromMeditation: bonusXp,
        buffUntil: profile.activeXpBuffUntil,
      },
    };
  }

  private getProfileOrThrow(userId: string): SiggyProfile {
    const profile = this.state.profiles[userId];
    if (!profile) {
      throw new Error('NO_SIGGY');
    }
    return profile;
  }

  private ensureCanAct(profile: SiggyProfile): void {
    if (profile.meditation) {
      throw new Error('MEDITATING');
    }
  }

  private duelScore(profile: SiggyProfile): number {
    return 0.6 * profile.power + 0.4 * profile.energyCurrent + RARITY_BONUS[profile.rarity];
  }

  private applyXpGain(profile: SiggyProfile, amount: number, canUseBuff: boolean, now: number): { gained: number; boosted: boolean } {
    const multiplier = canUseBuff && profile.activeXpBuffUntil > now ? 1.15 : 1;
    const gained = Math.max(1, Math.ceil(amount * multiplier));
    profile.xp += gained;
    this.applyLevelAndRarity(profile);
    return { gained, boosted: multiplier > 1 };
  }

  private toStatCard(profile: SiggyProfile): SiggyStatCard {
    return {
      title: `🐈 ${profile.rarity} Ritty`,
      owner: profile.usernameSnapshot,
      level: profile.level,
      rarity: profile.rarity,
      xp: profile.xp,
      power: profile.power,
      energy: profile.energyCurrent,
      energyMax: profile.power,
      imagePath: this.rarityImages[profile.rarity],
    };
  }

  async createSiggy(userId: string, username: string): Promise<{ created: boolean; card: SiggyStatCard }> {
    await this.ensureLoaded();

    const existing = this.state.profiles[userId];
    if (existing) {
      existing.usernameSnapshot = username;
      logger.info(
        { userId, username, profiles: this.profilesCount() },
        'Siggy already exists for user',
      );
      return { created: false, card: this.toStatCard(existing) };
    }

    const now = Date.now();
    const profile: SiggyProfile = {
      userId,
      usernameSnapshot: username,
      createdAt: now,
      xp: 0,
      level: 1,
      rarity: 'Common',
      power: 70,
      energyCurrent: 70,
      inventory: emptyInventory(),
      cooldowns: {
        questReadyAt: 0,
        duelReadyAt: 0,
      },
      daily: {
        dayKeyUtc: nowUtcDayKey(now),
        questsUsed: 0,
        duelsUsed: 0,
      },
      meditation: null,
      activeXpBuffUntil: 0,
    };

    this.state.profiles[userId] = profile;
    await this.persist();
    logger.info(
      { userId, username, profiles: this.profilesCount() },
      'Siggy created for user',
    );
    return { created: true, card: this.toStatCard(profile) };
  }

  async getSiggyCard(userId: string, username?: string): Promise<{ card: SiggyStatCard; meditationCompleted?: { xpFromMeditation: number; buffUntil: number } } | null> {
    await this.ensureLoaded();
    const profile = this.state.profiles[userId];
    if (!profile) {
      logger.warn(
        { userId, username, profiles: this.profilesCount() },
        'Siggy profile not found on getSiggyCard',
      );
      return null;
    }

    if (username) {
      profile.usernameSnapshot = username;
    }

    const now = Date.now();
    const settled = this.settleMeditation(profile, now);
    if (settled.changed) {
      await this.persist();
    }

    return {
      card: this.toStatCard(profile),
      meditationCompleted: settled.completed,
    };
  }

  async getItems(userId: string, username?: string): Promise<{ profile: SiggyProfile; meditationCompleted?: { xpFromMeditation: number; buffUntil: number } }> {
    await this.ensureLoaded();
    const profile = this.getProfileOrThrow(userId);

    if (username) {
      profile.usernameSnapshot = username;
    }

    const settled = this.settleMeditation(profile, Date.now());
    if (settled.changed) {
      await this.persist();
    }

    return { profile: cloneProfile(profile), meditationCompleted: settled.completed };
  }

  async runQuest(userId: string, username: string): Promise<SiggyQuestResult> {
    await this.ensureLoaded();
    const now = Date.now();
    const profile = this.getProfileOrThrow(userId);
    profile.usernameSnapshot = username;

    this.resolveDaily(profile, now);
    const settled = this.settleMeditation(profile, now);
    this.ensureCanAct(profile);

    if (profile.daily.questsUsed >= QUEST_DAILY_LIMIT) {
      throw new Error('QUEST_DAILY_LIMIT');
    }
    if (now < profile.cooldowns.questReadyAt) {
      throw new Error('QUEST_COOLDOWN');
    }

    const questLine = pickQuestLine();
    const xpRoll = randomInt(8, 16);
    const xp = this.applyXpGain(profile, xpRoll, true, now);

    profile.daily.questsUsed += 1;
    profile.cooldowns.questReadyAt = now + QUEST_COOLDOWN_MS;
    profile.inventory.voidRitualMilk += 1;

    await this.persist();

    return {
      profile: cloneProfile(profile),
      line: questLine,
      xpGained: xp.gained,
      gainedMilk: 1,
      boosted: xp.boosted,
      questsLeftToday: QUEST_DAILY_LIMIT - profile.daily.questsUsed,
      nextQuestAt: profile.cooldowns.questReadyAt,
      meditationCompleted: settled.completed,
    };
  }

  async startMeditation(userId: string, username: string): Promise<SiggyMeditationStartResult> {
    await this.ensureLoaded();
    const now = Date.now();
    const profile = this.getProfileOrThrow(userId);
    profile.usernameSnapshot = username;

    const settled = this.settleMeditation(profile, now);
    if (profile.meditation) {
      throw new Error('MEDITATING');
    }

    profile.meditation = {
      startedAt: now,
      endsAt: now + MEDITATION_DURATION_MS,
    };

    await this.persist();

    return {
      profile: cloneProfile(profile),
      endsAt: profile.meditation.endsAt,
      meditationCompleted: settled.completed,
    };
  }

  async runFishing(userId: string, username: string): Promise<SiggyFishingResult> {
    await this.ensureLoaded();
    const now = Date.now();
    const profile = this.getProfileOrThrow(userId);
    profile.usernameSnapshot = username;

    const settled = this.settleMeditation(profile, now);
    this.ensureCanAct(profile);

    const roll = Math.random();
    let fish: FishDropType = 'mysticFish';
    if (roll > 0.92) {
      fish = 'megaMysticFish';
    } else if (roll > 0.7) {
      fish = 'epicMysticFish';
    }

    const xpBase = Math.max(5, Math.ceil(profile.xp * 0.05));
    profile.xp += xpBase;
    this.applyLevelAndRarity(profile);
    profile.inventory[fish] += 1;

    await this.persist();

    return {
      profile: cloneProfile(profile),
      fish,
      fishLabel: FISH_LABEL[fish],
      xpGained: xpBase,
      meditationCompleted: settled.completed,
    };
  }

  async feed(userId: string, username: string, item: FeedItemType): Promise<SiggyFeedResult> {
    await this.ensureLoaded();
    const now = Date.now();
    const profile = this.getProfileOrThrow(userId);
    profile.usernameSnapshot = username;

    const settled = this.settleMeditation(profile, now);
    if (profile.inventory[item] <= 0) {
      throw new Error('NO_ITEM');
    }

    profile.inventory[item] -= 1;

    let powerGain = 0;
    switch (item) {
      case 'mysticFish':
        powerGain = randomInt(0, 30);
        break;
      case 'epicMysticFish':
        powerGain = randomInt(30, 50);
        break;
      case 'megaMysticFish':
        powerGain = randomInt(50, 100);
        break;
      case 'voidRitualMilk':
        powerGain = randomInt(25, 45);
        break;
      default:
        powerGain = 0;
    }

    const oldPower = profile.power;
    profile.power = clamp(profile.power + powerGain, 0, 100);
    const appliedPowerGain = profile.power - oldPower;

    const oldEnergy = profile.energyCurrent;
    profile.energyCurrent = clamp(profile.energyCurrent + appliedPowerGain, 0, profile.power);
    const appliedEnergyGain = profile.energyCurrent - oldEnergy;

    await this.persist();

    return {
      profile: cloneProfile(profile),
      item,
      powerAdded: appliedPowerGain,
      energyAdded: appliedEnergyGain,
      meditationCompleted: settled.completed,
    };
  }

  async createDuelChallenge(challengerId: string, challengerName: string, opponentId: string): Promise<SiggyDuelChallengeResult> {
    await this.ensureLoaded();
    const now = Date.now();
    const challenger = this.getProfileOrThrow(challengerId);
    const opponent = this.getProfileOrThrow(opponentId);

    challenger.usernameSnapshot = challengerName;
    this.resolveDaily(challenger, now);
    this.resolveDaily(opponent, now);

    const settledChallenger = this.settleMeditation(challenger, now);
    this.settleMeditation(opponent, now);
    this.ensureCanAct(challenger);
    this.ensureCanAct(opponent);

    if (challengerId === opponentId) {
      throw new Error('DUEL_SELF');
    }
    if (challenger.daily.duelsUsed >= DUEL_DAILY_LIMIT) {
      throw new Error('DUEL_DAILY_LIMIT_CHALLENGER');
    }
    if (opponent.daily.duelsUsed >= DUEL_DAILY_LIMIT) {
      throw new Error('DUEL_DAILY_LIMIT_OPPONENT');
    }
    if (now < challenger.cooldowns.duelReadyAt) {
      throw new Error('DUEL_COOLDOWN_CHALLENGER');
    }
    if (now < opponent.cooldowns.duelReadyAt) {
      throw new Error('DUEL_COOLDOWN_OPPONENT');
    }

    const levelDiff = Math.abs(challenger.level - opponent.level);
    const rarityDiff = Math.abs(rarityRank(challenger.rarity) - rarityRank(opponent.rarity));
    if (levelDiff > 10 || rarityDiff > 1) {
      throw new Error('DUEL_MISMATCH');
    }

    const challenge: DuelChallenge = {
      id: crypto.randomUUID(),
      challengerId,
      opponentId,
      createdAt: now,
      expiresAt: now + DUEL_CHALLENGE_TTL_MS,
    };
    this.duelChallenges.set(challenge.id, challenge);

    if (settledChallenger.changed) {
      await this.persist();
    }

    return {
      challenge,
      challenger: cloneProfile(challenger),
      opponent: cloneProfile(opponent),
      meditationCompletedChallenger: settledChallenger.completed,
    };
  }

  async resolveDuel(challengeId: string, acceptingUserId: string): Promise<SiggyDuelResult> {
    await this.ensureLoaded();
    const now = Date.now();
    const challenge = this.duelChallenges.get(challengeId);
    if (!challenge) {
      throw new Error('DUEL_CHALLENGE_MISSING');
    }
    if (challenge.expiresAt < now) {
      this.duelChallenges.delete(challengeId);
      throw new Error('DUEL_CHALLENGE_EXPIRED');
    }
    if (challenge.opponentId !== acceptingUserId) {
      throw new Error('DUEL_NOT_TARGET');
    }

    const challenger = this.getProfileOrThrow(challenge.challengerId);
    const opponent = this.getProfileOrThrow(challenge.opponentId);

    this.resolveDaily(challenger, now);
    this.resolveDaily(opponent, now);
    this.settleMeditation(challenger, now);
    this.settleMeditation(opponent, now);
    this.ensureCanAct(challenger);
    this.ensureCanAct(opponent);

    if (challenger.daily.duelsUsed >= DUEL_DAILY_LIMIT || opponent.daily.duelsUsed >= DUEL_DAILY_LIMIT) {
      this.duelChallenges.delete(challengeId);
      throw new Error('DUEL_DAILY_LIMIT');
    }
    if (now < challenger.cooldowns.duelReadyAt || now < opponent.cooldowns.duelReadyAt) {
      this.duelChallenges.delete(challengeId);
      throw new Error('DUEL_COOLDOWN');
    }

    const scoreA = this.duelScore(challenger);
    const scoreB = this.duelScore(opponent);
    const probabilityForChallenger = clamp(0.5 + clamp((scoreA - scoreB) / 200, -0.15, 0.15), 0.05, 0.95);

    const challengerWins = Math.random() < probabilityForChallenger;
    const winner = challengerWins ? challenger : opponent;
    const loser = challengerWins ? opponent : challenger;

    const xpGain = this.applyXpGain(winner, randomInt(18, 30), true, now).gained;
    const xpLoss = Math.ceil(loser.xp * 0.2);
    loser.xp = Math.max(0, loser.xp - xpLoss);

    const powerLoss = randomInt(10, 25);
    const energyLoss = randomInt(10, 25);
    loser.power = clamp(loser.power - powerLoss, 0, 100);
    loser.energyCurrent = clamp(loser.energyCurrent - energyLoss, 0, loser.power);

    this.applyLevelAndRarity(loser);

    challenger.daily.duelsUsed += 1;
    opponent.daily.duelsUsed += 1;
    challenger.cooldowns.duelReadyAt = now + DUEL_COOLDOWN_MS;
    opponent.cooldowns.duelReadyAt = now + DUEL_COOLDOWN_MS;

    this.duelChallenges.delete(challengeId);
    await this.persist();

    return {
      challenge,
      winnerUserId: winner.userId,
      loserUserId: loser.userId,
      winnerXpGain: xpGain,
      loserXpLoss: xpLoss,
      loserPowerLoss: powerLoss,
      loserEnergyLoss: energyLoss,
      probabilityForChallenger,
      challenger: cloneProfile(challenger),
      opponent: cloneProfile(opponent),
    };
  }

  formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) {
      return `${seconds}s`;
    }
    return `${minutes}m ${seconds}s`;
  }

  getQuestDailyLimit(): number {
    return QUEST_DAILY_LIMIT;
  }

  getDuelDailyLimit(): number {
    return DUEL_DAILY_LIMIT;
  }

  getProfileById(userId: string): SiggyProfile | null {
    const profile = this.state.profiles[userId];
    return profile ? cloneProfile(profile) : null;
  }
}
