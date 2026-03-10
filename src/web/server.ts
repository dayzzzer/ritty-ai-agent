import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appConfig } from '../config.js';
import { logger } from '../logger.js';
import type { BotServices } from '../services/botServices.js';
import type { AiHistoryTurn } from '../ai/aiService.js';
import { buildImageAttachmentFromPath } from '../utils/imageAttachment.js';
import {
  detectRittyActionFromText,
  formatRittyActionsList,
  getRittyActionById,
  type RittyAction,
} from '../actions/rittyActions.js';

export interface WebChatRequest {
  sessionId?: string;
  text?: string;
}

interface QuizOption {
  key: string;
  value: string;
}

interface WebQuizPayload {
  active: boolean;
  question?: string;
  options?: QuizOption[];
  progress?: string;
  score?: string;
  feedback?: string;
}

interface WebImagePayload {
  kind: 'url' | 'inline';
  url?: string;
  mimeType?: string;
  base64?: string;
  filename?: string;
}

interface WebActionVideoPayload {
  id: string;
  name: string;
  url: string;
}

interface WebAssistantPayload {
  text: string;
  sources?: string[];
  image?: WebImagePayload;
  quiz?: WebQuizPayload;
  actionVideo?: WebActionVideoPayload;
}

export interface WebChatResponse {
  sessionId: string;
  assistant: WebAssistantPayload;
  shouldReact: boolean;
}

const WEB_CHAT_HISTORY_LIMIT = 12;
const WHAT_IS_RITUAL_FALLBACK_IMAGE_URL = '/media/what-is-ritual.svg';
const webChatHistory = new Map<string, AiHistoryTurn[]>();

function readHistory(sessionId: string): AiHistoryTurn[] {
  return webChatHistory.get(sessionId) ?? [];
}

function appendHistory(sessionId: string, turn: AiHistoryTurn): void {
  const current = webChatHistory.get(sessionId) ?? [];
  const next = [...current, { role: turn.role, text: turn.text.slice(0, 2000) }].slice(-WEB_CHAT_HISTORY_LIMIT);
  webChatHistory.set(sessionId, next);
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.mp4':
    default:
      return 'video/mp4';
  }
}

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function parseOptionLetter(value: string): number {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return -1;
  }
  const idx = normalized.charCodeAt(0) - 65;
  if (idx < 0 || idx > 25) {
    return -1;
  }
  return idx;
}

function buildActiveQuizPayload(session: { questions: Array<{ question: string; options: string[] }>; currentIndex: number; score: number }): WebQuizPayload {
  const question = session.questions[session.currentIndex];

  return {
    active: true,
    question: question.question,
    options: question.options.map((value, index) => ({
      key: optionLetter(index),
      value,
    })),
    progress: `${session.currentIndex + 1}/${session.questions.length}`,
    score: `${session.score}/${session.questions.length}`,
  };
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const part of req) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    total += chunk.length;

    if (total > 512_000) {
      throw new Error('Payload too large');
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw) as T;
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function serveStaticAsset(res: http.ServerResponse, staticDir: string, relativeAssetPath: string): Promise<void> {
  const cleaned = relativeAssetPath.replace(/^\/+/, '');
  const resolved = path.resolve(staticDir, cleaned);

  if (!resolved.startsWith(staticDir) || !existsSync(resolved)) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const stat = statSync(resolved);
  if (!stat.isFile()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  res.statusCode = 200;
  res.setHeader('content-type', getContentType(resolved));
  res.setHeader('cache-control', 'no-cache');
  createReadStream(resolved).pipe(res);
}

function streamVideo(req: http.IncomingMessage, res: http.ServerResponse, videoPath: string): void {
  if (!existsSync(videoPath)) {
    sendJson(res, 404, { error: 'Video not found' });
    return;
  }

  const stat = statSync(videoPath);
  const total = stat.size;
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Type': getContentType(videoPath),
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    createReadStream(videoPath).pipe(res);
    return;
  }

  const [startRaw, endRaw] = range.replace(/bytes=/, '').split('-');
  const start = Number.parseInt(startRaw, 10);
  const end = endRaw ? Number.parseInt(endRaw, 10) : total - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end >= total || start > end) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` });
    res.end();
    return;
  }

  const chunkSize = end - start + 1;
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': getContentType(videoPath),
    'Cache-Control': 'no-store',
  });

  createReadStream(videoPath, { start, end }).pipe(res);
}

async function inlineImageFromPath(imagePath: string): Promise<WebImagePayload> {
  const image = await buildImageAttachmentFromPath(imagePath);
  const ext = path.extname(image.name).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg';

  return {
    kind: 'inline',
    filename: image.name,
    mimeType,
    base64: image.buffer.toString('base64'),
  };
}

async function handleAsk(question: string, services: BotServices, history: AiHistoryTurn[] = []): Promise<WebAssistantPayload> {
  const answer = await services.aiService.answerRitualQuestion(question, services.getDocsIndex(), history);

  const payload: WebAssistantPayload = {
    text: answer.text,
    sources: answer.citations,
  };

  if (answer.imagePath) {
    if (path.basename(answer.imagePath).toLowerCase() === 'ritual-chain.svg') {
      payload.image = {
        kind: 'url',
        url: WHAT_IS_RITUAL_FALLBACK_IMAGE_URL,
        filename: 'what-is-ritual.svg',
      };
      return payload;
    }

    try {
      payload.image = await inlineImageFromPath(answer.imagePath);
    } catch (error) {
      logger.warn({ err: error, imagePath: answer.imagePath }, 'Could not inline answer image, using URL fallback');
      payload.image = {
        kind: 'url',
        url: WHAT_IS_RITUAL_FALLBACK_IMAGE_URL,
        filename: 'what-is-ritual.svg',
      };
    }
  } else if (answer.imageUrl) {
    payload.image = {
      kind: 'url',
      url: answer.imageUrl,
    };
  }

  return payload;
}

async function handleArtRitual(services: BotServices): Promise<WebAssistantPayload> {
  const art = await services.artService.getRandomArtwork();

  return {
    text: `${art.title || 'Untitled'}\nAuthor: ${art.author} (${art.twitter || 'https://x.com/'})`,
    image: {
      kind: 'url',
      url: art.src,
    },
  };
}

async function handleRitualPfp(services: BotServices): Promise<WebAssistantPayload> {
  const generated = await services.pfpService.generateRandomPfp();
  const traits = generated.selected.map((entry) => `${entry.layer}: ${entry.name}`).join('\n');

  return {
    text: `Your random Ritual PFP is ready.\n\nSelected traits:\n${traits}`,
    image: {
      kind: 'inline',
      mimeType: 'image/png',
      filename: `ritty-pfp-${Date.now()}.png`,
      base64: generated.buffer.toString('base64'),
    },
  };
}

async function handleTeam(services: BotServices): Promise<WebAssistantPayload> {
  const members = await services.teamService.getTeamMembers();
  const text = members
    .map((member) => `${member.name} — ${member.role}\n${member.description}\n${member.twitter}`)
    .join('\n\n');

  return {
    text: text || 'Team list is empty.',
  };
}

async function handleRitualRandom(services: BotServices): Promise<WebAssistantPayload> {
  const fact = await services.factService.getRandomFact();

  return {
    text: `${fact.text}\n\nSource: ${fact.source}`,
  };
}

async function handleRitualTest(arg: string | undefined, sessionId: string, services: BotServices): Promise<WebAssistantPayload> {
  if (!arg || arg.toLowerCase() === 'start') {
    services.quizService.clearSession(sessionId);
    const session = await services.quizService.createSession(sessionId);
    return {
      text: 'Ritual docs quiz started. Pick an answer option.',
      quiz: buildActiveQuizPayload(session),
    };
  }

  const active = services.quizService.getSession(sessionId);
  if (!active) {
    return {
      text: 'No active quiz. Use /ritualtest to start a new one.',
      quiz: { active: false },
    };
  }

  const optionIndex = parseOptionLetter(arg);
  if (optionIndex < 0 || optionIndex >= active.questions[active.currentIndex].options.length) {
    return {
      text: 'Invalid option. Reply with /ritualtest A (or B/C/...).',
      quiz: buildActiveQuizPayload(active),
    };
  }

  const result = services.quizService.answerCurrentQuestion(sessionId, optionIndex);
  const correctLetter = optionLetter(result.question.correctIndex);

  if (result.finished) {
    return {
      text: [
        result.isCorrect ? 'Correct.' : 'Incorrect.',
        `Correct answer: ${correctLetter}.`,
        `Explanation: ${result.question.explanation}`,
        `Final score: ${result.session.score}/${result.session.questions.length}`,
      ].join('\n'),
      quiz: {
        active: false,
        score: `${result.session.score}/${result.session.questions.length}`,
      },
    };
  }

  const feedback = result.isCorrect
    ? 'Correct.'
    : `Incorrect. Correct answer: ${correctLetter}.\nExplanation: ${result.question.explanation}`;

  return {
    text: feedback,
    quiz: {
      ...buildActiveQuizPayload(result.session),
      feedback,
    },
  };
}

function buildActionVideoPayload(action: RittyAction): WebActionVideoPayload {
  return {
    id: action.id,
    name: action.name,
    url: `/media/action/${encodeURIComponent(action.id)}.mp4`,
  };
}

function handleActionsList(): WebAssistantPayload {
  return {
    text: formatRittyActionsList(),
  };
}

function handleActionRequest(action: RittyAction): WebAssistantPayload {
  return {
    text: `Playing action: ${action.name}.`,
    actionVideo: buildActionVideoPayload(action),
  };
}

export async function processWebChat(payload: WebChatRequest, services: BotServices): Promise<WebChatResponse> {
  const sessionId = payload.sessionId?.trim() || randomUUID();
  const text = payload.text?.trim() || '';

  if (!text) {
    return {
      sessionId,
      assistant: {
        text: 'Please send a message.',
      },
      shouldReact: false,
    };
  }

  const normalized = text.startsWith('/') ? text.slice(1).trim() : text;
  const [rawCommandName, ...args] = normalized.split(/\s+/g);
  const commandName = rawCommandName?.toLowerCase();
  const history = readHistory(sessionId);

  let assistant: WebAssistantPayload;

  try {
    if (text.startsWith('/')) {
      switch (commandName) {
        case 'ask':
        case 'askritty': {
          assistant = await handleAsk(args.join(' '), services, history);
          break;
        }
        case 'artritual': {
          assistant = await handleArtRitual(services);
          break;
        }
        case 'ritualpfp': {
          assistant = await handleRitualPfp(services);
          break;
        }
        case 'team': {
          assistant = await handleTeam(services);
          break;
        }
        case 'ritualrandom': {
          assistant = await handleRitualRandom(services);
          break;
        }
        case 'ritualtest': {
          assistant = await handleRitualTest(args[0], sessionId, services);
          break;
        }
        case 'actions': {
          assistant = handleActionsList();
          break;
        }
        default: {
          assistant = {
            text: 'Unknown command. Use /askritty, /artritual, /ritualpfp, /team, /ritualrandom, /ritualtest, /actions.',
          };
          break;
        }
      }
    } else {
      const detectedAction = detectRittyActionFromText(text);
      if (detectedAction) {
        assistant = handleActionRequest(detectedAction);
      } else {
        const activeQuiz = services.quizService.getSession(sessionId);
        if (activeQuiz && text.length <= 3) {
          assistant = await handleRitualTest(text, sessionId, services);
        } else {
          assistant = await handleAsk(text, services, history);
        }
      }
    }
  } catch (error) {
    logger.error({ err: error, sessionId }, 'Web chat request failed');
    assistant = {
      text: 'Something went wrong while processing your request.',
    };
  }

  const trackHistory = !text.startsWith('/') || commandName === 'ask' || commandName === 'askritty';
  if (trackHistory) {
    appendHistory(sessionId, { role: 'user', text });
    appendHistory(sessionId, { role: 'assistant', text: assistant.text });
  }

  return {
    sessionId,
    assistant,
    shouldReact: assistant.actionVideo ? false : Math.random() < 0.5,
  };
}

export function startWebServer(services: BotServices): void {
  const staticDir = appConfig.web.staticDir;

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method || 'GET';
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      if (pathname === '/healthz' || pathname === '/api/health') {
        sendJson(res, 200, { status: 'ok', service: 'ritty-ai', time: new Date().toISOString() });
        return;
      }

      if (pathname === '/media/idle' || pathname === '/media/idle.mp4') {
        streamVideo(req, res, appConfig.web.idleVideoPath);
        return;
      }

      if (pathname === '/media/reaction' || pathname === '/media/reaction.mp4') {
        streamVideo(req, res, appConfig.web.reactionVideoPath);
        return;
      }

      if (pathname === '/media/what-is-ritual.svg') {
        if (!existsSync(appConfig.whatIsRitualImagePath)) {
          sendJson(res, 404, { error: 'Image not found' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': getContentType(appConfig.whatIsRitualImagePath),
          'Content-Length': statSync(appConfig.whatIsRitualImagePath).size,
          'Cache-Control': 'no-store',
        });
        createReadStream(appConfig.whatIsRitualImagePath).pipe(res);
        return;
      }

      if (pathname.startsWith('/media/action/')) {
        const rawActionId = decodeURIComponent(pathname.slice('/media/action/'.length));
        const actionId = rawActionId.endsWith('.mp4') ? rawActionId.slice(0, -4) : rawActionId;
        const action = getRittyActionById(actionId);
        if (!action) {
          sendJson(res, 404, { error: 'Action not found' });
          return;
        }

        streamVideo(req, res, action.videoPath);
        return;
      }

      if (method === 'POST' && pathname === '/api/web/chat') {
        const body = await readJsonBody<WebChatRequest>(req);
        const result = await processWebChat(body, services);
        sendJson(res, 200, result);
        return;
      }

      if (pathname === '/app' || pathname === '/app/') {
        await serveStaticAsset(res, staticDir, 'index.html');
        return;
      }

      if (pathname.startsWith('/app/')) {
        const relativeAssetPath = pathname.replace('/app/', '');
        await serveStaticAsset(res, staticDir, relativeAssetPath);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      logger.error({ err: error }, 'Web server request error');
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });

  server.listen(appConfig.healthcheckPort, () => {
    logger.info({ port: appConfig.healthcheckPort }, 'Web/API server started');
  });
}
