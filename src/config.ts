import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default('gpt-5-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  DISCORD_GUILD_ID: z.string().optional(),
  ARTS_API_URL: z.string().url().default('https://ritualarts.xyz/api/arts'),
  PFP_ASSETS_ROOT: z.string().default('./assets/characters'),
  TEAM_DATA_PATH: z.string().default('./src/data/team.json'),
  FACTS_DATA_PATH: z.string().default('./src/data/ritual_facts.json'),
  QUIZ_DATA_PATH: z.string().default('./src/data/quiz_questions.json'),
  WHAT_IS_RITUAL_IMAGE_PATH: z.string().default('./files by user/what is ritual/ritual-chain.svg'),
  WEB_IDLE_VIDEO_PATH: z.string().default('./files by user/HI/IMG_9732.MP4'),
  WEB_REACTION_VIDEO_PATH: z.string().default('./files by user/HI/REACTION.mp4'),
  WEB_STATIC_DIR: z.string().default('./src/web/public'),
  SIGGY_RPG_STATE_PATH: z.string().default('./storage/siggy_rpg_state.json'),
  SIGGY_COMMON_IMAGE_PATH: z.string().default('./files by user/common/common.png'),
  SIGGY_RARE_IMAGE_PATH: z.string().default('./files by user/Rare/rare.png'),
  SIGGY_EPIC_IMAGE_PATH: z.string().default('./files by user/epic/epic.png'),
  SIGGY_LEGENDARY_IMAGE_PATH: z.string().default('./files by user/legendary/legendary.png'),
  SIGGY_FORBIDDEN_IMAGE_PATH: z.string().default('./files by user/forbidden/forbidden.png'),
  DOCS_INDEX_PATH: z.string().default('./storage/ritual_docs.index.json'),
  DOCS_SOURCES_PATH: z.string().default('./storage/ritual_docs.sources.json'),
  DOCS_SEED_URLS_PATH: z.string().default('./src/data/docs_seed_urls.json'),
  PREFIX_COMMAND_TOKEN: z.string().default('!'),
  ENABLE_DOCS_CRON: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  DOCS_CRON_HOUR_UTC: z
    .string()
    .default('3')
    .transform((value) => Number.parseInt(value, 10))
    .pipe(z.number().int().min(0).max(23)),
  HEALTHCHECK_PORT: z
    .string()
    .default('8787')
    .transform((value) => Number.parseInt(value, 10))
    .pipe(z.number().int().min(1).max(65535)),
  MEDIA_BASE_URL: z.string().url().default('https://ritty-media.onrender.com'),
  MEDIA_PUBLIC_BASE_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${message}`);
}

const env = parsed.data;

export const appConfig = {
  discord: {
    token: env.DISCORD_TOKEN.trim(),
    clientId: env.DISCORD_CLIENT_ID.trim(),
    guildId: env.DISCORD_GUILD_ID?.trim(),
    prefix: env.PREFIX_COMMAND_TOKEN,
  },
  openai: {
    apiKey: env.OPENAI_API_KEY.trim(),
    model: env.OPENAI_MODEL,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
  },
  artsApiUrl: env.ARTS_API_URL,
  pfpAssetsRoot: path.resolve(env.PFP_ASSETS_ROOT),
  teamDataPath: path.resolve(env.TEAM_DATA_PATH),
  factsDataPath: path.resolve(env.FACTS_DATA_PATH),
  quizDataPath: path.resolve(env.QUIZ_DATA_PATH),
  whatIsRitualImagePath: path.resolve(env.WHAT_IS_RITUAL_IMAGE_PATH),
  web: {
    idleVideoPath: path.resolve(env.WEB_IDLE_VIDEO_PATH),
    reactionVideoPath: path.resolve(env.WEB_REACTION_VIDEO_PATH),
    staticDir: path.resolve(env.WEB_STATIC_DIR),
  },
  siggyRpg: {
    statePath: path.resolve(env.SIGGY_RPG_STATE_PATH),
    rarityImages: {
      Common: path.resolve(env.SIGGY_COMMON_IMAGE_PATH),
      Rare: path.resolve(env.SIGGY_RARE_IMAGE_PATH),
      Epic: path.resolve(env.SIGGY_EPIC_IMAGE_PATH),
      Legendary: path.resolve(env.SIGGY_LEGENDARY_IMAGE_PATH),
      Forbidden: path.resolve(env.SIGGY_FORBIDDEN_IMAGE_PATH),
    },
  },
  docsIndexPath: path.resolve(env.DOCS_INDEX_PATH),
  docsSourcesPath: path.resolve(env.DOCS_SOURCES_PATH),
  docsSeedUrlsPath: path.resolve(env.DOCS_SEED_URLS_PATH),
  docsCron: {
    enabled: env.ENABLE_DOCS_CRON,
    hourUtc: env.DOCS_CRON_HOUR_UTC,
  },
  healthcheckPort: env.HEALTHCHECK_PORT,
  mediaBaseUrl: env.MEDIA_BASE_URL,
  mediaPublicBaseUrl: env.MEDIA_PUBLIC_BASE_URL,
} as const;

export type AppConfig = typeof appConfig;
