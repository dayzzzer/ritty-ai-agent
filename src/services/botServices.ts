import OpenAI from 'openai';
import { appConfig } from '../config.js';
import { AiService } from '../ai/aiService.js';
import { loadDocsIndex, type DocsIndex } from '../ai/docsIndex.js';
import { ArtService } from './artService.js';
import { FactService } from './factService.js';
import { PfpService } from './pfpService.js';
import { QuizService } from './quizService.js';
import { TeamService } from './teamService.js';
import { SiggyRpgService } from './siggyRpgService.js';

export class BotServices {
  readonly openai = new OpenAI({ apiKey: appConfig.openai.apiKey });
  readonly artService = new ArtService(appConfig.artsApiUrl);
  readonly pfpService = new PfpService(appConfig.pfpAssetsRoot);
  readonly teamService = new TeamService(appConfig.teamDataPath);
  readonly factService = new FactService(appConfig.factsDataPath);
  readonly quizService = new QuizService(appConfig.quizDataPath);
  readonly siggyRpgService = new SiggyRpgService(
    appConfig.siggyRpg.statePath,
    appConfig.siggyRpg.rarityImages,
  );
  readonly aiService = new AiService(
    this.openai,
    appConfig.openai.model,
    appConfig.openai.embeddingModel,
    appConfig.whatIsRitualImagePath,
  );

  private docsIndex: DocsIndex | null = null;

  async loadDocsIndex(): Promise<DocsIndex | null> {
    this.docsIndex = await loadDocsIndex(appConfig.docsIndexPath);
    return this.docsIndex;
  }

  getDocsIndex(): DocsIndex | null {
    return this.docsIndex;
  }
}
