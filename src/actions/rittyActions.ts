import path from 'node:path';

export type RittyActionId = 'dance' | 'jump' | 'winner' | 'balalaika' | 'sleep' | 'gamepad';

export interface RittyAction {
  id: RittyActionId;
  name: string;
  description: string;
  videoPath: string;
  patterns: RegExp[];
}

const ACTIONS: RittyAction[] = [
  {
    id: 'dance',
    name: 'Dance',
    description: 'RITTY dances.',
    videoPath: path.resolve('./files by user/dance/IMG_9741.MP4'),
    patterns: [
      /\bdance\b/u,
      /\bdancing\b/u,
      /танц/u,
      /baila/u,
      /dan[cs]e/u,
      /tanz/u,
    ],
  },
  {
    id: 'jump',
    name: 'Jump',
    description: 'RITTY jumps.',
    videoPath: path.resolve('./files by user/jump/IMG_9737.MP4'),
    patterns: [
      /\bjump\b/u,
      /\bjumping\b/u,
      /прыг/u,
      /salta/u,
      /saut/u,
      /spring/u,
    ],
  },
  {
    id: 'winner',
    name: 'Happy Winner',
    description: 'RITTY celebrates a win.',
    videoPath: path.resolve('./files by user/happy winner/IMG_9740.MP4'),
    patterns: [
      /\bwinner\b/u,
      /\bwin\b/u,
      /\bvictory\b/u,
      /\bcelebrat/u,
      /побед/u,
      /выигр/u,
      /campe[oó]n/u,
    ],
  },
  {
    id: 'balalaika',
    name: 'Balalaika',
    description: 'RITTY plays balalaika.',
    videoPath: path.resolve('./files by user/plays the balalaika/IMG_9739.MP4'),
    patterns: [/\bbalalaika\b/u, /балалайк/u, /play.*balalaika/u, /музык/u],
  },
  {
    id: 'sleep',
    name: 'Sleep',
    description: 'RITTY sleeps.',
    videoPath: path.resolve('./files by user/sleeping/IMG_9742.MP4'),
    patterns: [/\bsleep\b/u, /\bsleeping\b/u, /\bnap\b/u, /спи/u, /сон/u, /dorm/i],
  },
  {
    id: 'gamepad',
    name: 'Gamepad',
    description: 'RITTY plays on gamepad.',
    videoPath: path.resolve('./files by user/playing on gamepad/IMG_9738.MP4'),
    patterns: [
      /\bgamepad\b/u,
      /\bcontroller\b/u,
      /\bgaming\b/u,
      /\bplay game/u,
      /геймпад/u,
      /джойстик/u,
      /игра[йт]/u,
    ],
  },
];

const ACTION_BY_ID = new Map<RittyActionId, RittyAction>(ACTIONS.map((entry) => [entry.id, entry]));

const REQUEST_HINTS = [
  /\b(can you|please|do|show|play)\b/u,
  /\bсделай\b/u,
  /\bпокажи\b/u,
  /\bвключи\b/u,
  /\bдавай\b/u,
  /\bhaz\b/u,
  /\bmu[ée]stra\b/u,
  /\bfait\b/u,
  /\bmach\b/u,
];

function normalize(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasRequestIntent(text: string): boolean {
  if (!text) {
    return false;
  }

  if (text.split(' ').length <= 5) {
    return true;
  }

  return REQUEST_HINTS.some((pattern) => pattern.test(text));
}

export function getRittyActions(): RittyAction[] {
  return ACTIONS;
}

export function getRittyActionById(id: string): RittyAction | undefined {
  return ACTION_BY_ID.get(id as RittyActionId);
}

export function detectRittyActionFromText(input: string): RittyAction | null {
  const normalized = normalize(input);
  if (!normalized) {
    return null;
  }

  for (const action of ACTIONS) {
    if (!action.patterns.some((pattern) => pattern.test(normalized))) {
      continue;
    }

    if (hasRequestIntent(normalized)) {
      return action;
    }
  }

  return null;
}

export function formatRittyActionsList(): string {
  const lines = ACTIONS.map((action) => `- ${action.id}: ${action.description}`);
  return ['Available actions:', ...lines, '', 'Ask naturally, or use `/actions` anytime.'].join('\n');
}
