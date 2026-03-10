# RITTY AI (Ritual Discord Bot + Web Chat)

Discord bot for Ritual community with:
- Slash commands + `!` aliases
- AI Q&A grounded on indexed Ritual docs (RAG)
- Artwork, PFP generation, team list, random facts, and quiz

## Commands
- `/artritual` or `!artRitual` - random approved art from `ritualarts.xyz`
- `/ritualpfp` or `!RitualPFP` - random generated Ritual avatar PNG
- `/team` or `!team` - team list with role + Twitter link
- `/ritualrandom` or `!ritualrandom` - random short Ritual fact
- `/ritualtest` or `!ritualtest` - 5-question interactive quiz
- `/askritty question:<text>` or `!askRitty <text>` - AI answer with sources

Also works in AI chat mode when bot is mentioned or in DM.

## Web App
- Open: `http://localhost:8787/app`
- Left side: SIGGY video loop (`WEB_IDLE_VIDEO_PATH`)
- Right side: web chat with slash-like commands:
  - `/askritty`
  - `/artritual`
  - `/ritualpfp`
  - `/team`
  - `/ritualrandom`
  - `/ritualtest`

If `WEB_REACTION_VIDEO_PATH` exists, web UI switches to reaction video on some responses.
If missing, UI uses a visual fallback effect.

## Setup
1. Install dependencies:

```bash
npm install
```

2. Copy env template and fill values:

```bash
cp .env.example .env
```

Required:
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `OPENAI_API_KEY`

3. Build docs index (recommended before first run):

```bash
npm run ingest:ritual-docs
```

4. Register slash commands:

```bash
npm run register:commands
```

5. Run bot:

```bash
npm run dev
```

## Data files
- `src/data/team.json`
- `src/data/ritual_facts.json`
- `src/data/quiz_questions.json`
- `src/data/docs_seed_urls.json`

## Notes
- `PFP_ASSETS_ROOT` should point to your local ritual PFP assets/manifest folder.
- Docs index is stored in `storage/ritual_docs.index.json`.
- Web/API server and health endpoint run on `HEALTHCHECK_PORT`.
