export type SiggyRarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Forbidden';

export interface SiggyInventory {
  mysticFish: number;
  epicMysticFish: number;
  megaMysticFish: number;
  voidRitualMilk: number;
}

export interface SiggyCooldowns {
  questReadyAt: number;
  duelReadyAt: number;
}

export interface SiggyDailyCounters {
  dayKeyUtc: string;
  questsUsed: number;
  duelsUsed: number;
}

export interface SiggyMeditationState {
  startedAt: number;
  endsAt: number;
}

export interface SiggyProfile {
  userId: string;
  usernameSnapshot: string;
  createdAt: number;
  xp: number;
  level: number;
  rarity: SiggyRarity;
  power: number;
  energyCurrent: number;
  inventory: SiggyInventory;
  cooldowns: SiggyCooldowns;
  daily: SiggyDailyCounters;
  meditation: SiggyMeditationState | null;
  activeXpBuffUntil: number;
}

export interface SiggyRpgState {
  profiles: Record<string, SiggyProfile>;
}

export interface DuelChallenge {
  id: string;
  challengerId: string;
  opponentId: string;
  createdAt: number;
  expiresAt: number;
}

export type FishDropType = 'mysticFish' | 'epicMysticFish' | 'megaMysticFish';
export type FeedItemType = FishDropType | 'voidRitualMilk';
