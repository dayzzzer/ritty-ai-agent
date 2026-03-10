import type { TeamMember } from './types.js';
import { dataSchemas, loadJsonFile } from './dataLoader.js';

export class TeamService {
  constructor(private readonly teamDataPath: string) {}

  async getTeamMembers(): Promise<TeamMember[]> {
    return loadJsonFile(this.teamDataPath, dataSchemas.team);
  }
}
