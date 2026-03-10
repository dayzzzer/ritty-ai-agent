import { pickRandom } from '../utils/random.js';
import type { RitualFact } from './types.js';
import { dataSchemas, loadJsonFile } from './dataLoader.js';

export class FactService {
  constructor(private readonly factsDataPath: string) {}

  async getRandomFact(): Promise<RitualFact> {
    const facts = await loadJsonFile(this.factsDataPath, dataSchemas.facts);
    return pickRandom(facts);
  }
}
