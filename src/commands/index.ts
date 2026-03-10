import { askRittyCommand } from './askRitty.js';
import { actionsCommand } from './actions.js';
import { artRitualCommand } from './artRitual.js';
import { feedCommand } from './feed.js';
import { fishingCommand } from './fishing.js';
import { itemsCommand } from './items.js';
import { mysiggyCommand } from './mysiggy.js';
import { newsiggyCommand } from './newsiggy.js';
import { questCommand } from './quest.js';
import { ritualPfpCommand } from './ritualPfp.js';
import { ritualRandomCommand } from './ritualRandom.js';
import { ritualTestCommand } from './ritualTest.js';
import { rittyDuelCommand, svsCommand } from './rittyDuel.js';
import { siggyMeditateCommand } from './siggyMeditate.js';
import { teamCommand } from './team.js';
import type { BotCommand } from './types.js';

export const commands: BotCommand[] = [
  newsiggyCommand,
  mysiggyCommand,
  itemsCommand,
  questCommand,
  siggyMeditateCommand,
  fishingCommand,
  feedCommand,
  rittyDuelCommand,
  svsCommand,
  actionsCommand,
  artRitualCommand,
  ritualPfpCommand,
  teamCommand,
  ritualRandomCommand,
  ritualTestCommand,
  askRittyCommand,
];

const aliasMap = new Map<string, BotCommand>();

for (const command of commands) {
  aliasMap.set(command.name.toLowerCase(), command);
  for (const alias of command.aliases) {
    aliasMap.set(alias.toLowerCase(), command);
  }
}

export function resolveCommand(input: string): BotCommand | undefined {
  return aliasMap.get(input.toLowerCase());
}
