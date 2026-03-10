import type { APIEmbed } from 'discord.js';
import type { FeedItemType } from '../services/siggyRpgTypes.js';
import type { SiggyStatCard } from '../services/siggyRpgService.js';

export function toRelativeTime(ms: number): string {
  const unix = Math.max(0, Math.floor(ms / 1000));
  return `<t:${unix}:R>`;
}

export function parseFeedItem(input: string): FeedItemType | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'mystic' || normalized === 'mysticfish' || normalized === 'mystic_fish') {
    return 'mysticFish';
  }
  if (normalized === 'epic' || normalized === 'epicmysticfish' || normalized === 'epic_mystic_fish') {
    return 'epicMysticFish';
  }
  if (normalized === 'mega' || normalized === 'megamysticfish' || normalized === 'mega_mystic_fish') {
    return 'megaMysticFish';
  }
  if (normalized === 'milk' || normalized === 'voidmilk' || normalized === 'void_ritual_milk') {
    return 'voidRitualMilk';
  }

  return null;
}

export function humanItemName(item: FeedItemType): string {
  switch (item) {
    case 'mysticFish':
      return 'Mystic Fish';
    case 'epicMysticFish':
      return 'Epic Mystic Fish';
    case 'megaMysticFish':
      return 'Mega Mystic Fish';
    case 'voidRitualMilk':
      return 'Void Ritual Milk';
    default:
      return item;
  }
}

export function buildSiggyCardEmbed(card: SiggyStatCard, imageUrl?: string): APIEmbed {
  return {
    title: card.title,
    description: [`Level ${card.level}`, '', `Power: ${card.power}%`, `Energy: ${card.energy}%`, `XP: ${card.xp}`].join('\n'),
    footer: {
      text: `User: ${card.owner}`,
    },
    image: imageUrl
      ? {
          url: imageUrl,
        }
      : undefined,
  };
}

export function formatMeditationCompletion(completed?: { xpFromMeditation: number; buffUntil: number }): string {
  if (!completed) {
    return '';
  }

  return [
    `Meditation complete: +${completed.xpFromMeditation} XP granted.`,
    `XP bonus window active until ${toRelativeTime(completed.buffUntil)}.`,
  ].join('\n');
}
