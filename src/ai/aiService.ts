import OpenAI from 'openai';
import { load } from 'cheerio';
import { RitualRetriever } from './retriever.js';
import type { DocsIndex } from './docsIndex.js';

export interface AiAnswer {
  text: string;
  citations: string[];
  usedRag: boolean;
  imagePath?: string;
  imageUrl?: string;
}

export interface AiHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export class AiService {
  private readonly retriever: RitualRetriever;
  private readonly docsImageCache = new Map<string, string | null>();
  private static readonly OFFICIAL_DOCS_URL = 'https://www.ritualfoundation.org/docs';
  private static readonly OFFICIAL_OVERVIEW_URL = 'https://www.ritualfoundation.org/docs/overview/what-is-ritual';
  private static readonly OFFICIAL_SITE_URL = 'https://ritual.net/';
  private static readonly RITUAL_KEYWORDS = [
    'ritual',
    'ритуал',
    'ritual foundation',
    'ritual docs',
    'ritual documentation',
    'ritual doc',
    'resonance',
    'symphony',
    'infernet',
    'evm++',
    'execution sidecars',
    'guardians',
    'node specialization',
    'model marketplace',
    'l2 raas',
    'onchain ai',
    'crypto x ai',
  ];

  private isGpt5Model(): boolean {
    return this.model.toLowerCase().startsWith('gpt-5');
  }

  private isRitualProjectMention(question: string): boolean {
    const lower = question.toLowerCase();
    return /\britual\b|ритуал(а|у|ом|е|ы|ов|ам|ами|ах)?/u.test(lower);
  }

  private looksLikeGenericRitualAnswer(text: string): boolean {
    const lower = text.toLowerCase();
    const genericSignals = [
      'in general sense',
      'general sense',
      'rituals help',
      'ceremony',
      'religious',
      'tradition',
      'cultural practice',
      'в общем смысле',
      'обряд',
      'религи',
      'церемони',
      'традици',
    ];
    const projectSignals = [
      'ritualfoundation',
      'ritual.net',
      'blockchain',
      'onchain',
      'evm',
      'sidecar',
      'resonance',
      'symphony',
      'guardians',
      'node specialization',
      'model marketplace',
      'crypto × ai',
      'crypto x ai',
    ];

    return genericSignals.some((token) => lower.includes(token)) && !projectSignals.some((token) => lower.includes(token));
  }

  private extractResponseText(response: OpenAI.Responses.Response): string {
    const direct = response.output_text?.trim();
    if (direct) {
      return direct;
    }

    const parts: string[] = [];
    for (const item of response.output ?? []) {
      if (item.type !== 'message') {
        continue;
      }
      for (const content of item.content ?? []) {
        if (content.type === 'output_text' && content.text) {
          parts.push(content.text);
        }
      }
    }

    return parts.join('\n').trim();
  }

  constructor(
    private readonly openai: OpenAI,
    private readonly model: string,
    embeddingModel: string,
    private readonly whatIsRitualImagePath: string,
  ) {
    this.retriever = new RitualRetriever(this.openai, embeddingModel);
  }

  async answerRitualQuestion(question: string, docsIndex: DocsIndex | null, history: AiHistoryTurn[] = []): Promise<AiAnswer> {
    const ritualProjectMention = this.isRitualProjectMention(question);
    const whatIsRitualIntent = this.isWhatIsRitualIntentHeuristic(question);
    const retrievalQuery = ritualProjectMention
      ? `${question}\nInterpret "Ritual" as the Ritual blockchain project by Ritual Foundation.`
      : question;
    const retrieval = docsIndex ? await this.retriever.retrieve(retrievalQuery, docsIndex, 6) : [];
    const lowerQuestion = question.toLowerCase();
    const topScore = retrieval[0]?.score ?? -1;
    const likelyRitualQuestion = this.isLikelyRitualQuestion(lowerQuestion, topScore);
    const docsLinkIntent = this.isDocsLinkIntent(lowerQuestion);
    const creativeRequest = this.isCreativeRequest(lowerQuestion);
    const attachWhatIsRitualImage = docsLinkIntent ? false : await this.shouldAttachWhatIsRitualImage(question);
    const shouldTryDocsGrounding = likelyRitualQuestion || topScore >= 0.22;

    const relevantRetrieval = shouldTryDocsGrounding
      ? retrieval.filter((item) => item.score >= 0.16).slice(0, 6)
      : [];
    const sources = relevantRetrieval.map((item) => item.chunk.sourceUrl);
    const uniqueSources = [...new Set(sources)].slice(0, 4);
    const docsContextImageUrl =
      likelyRitualQuestion && !attachWhatIsRitualImage && uniqueSources.length > 0
        ? await this.resolveDocsImageUrlForSources(uniqueSources)
        : undefined;

    if (docsLinkIntent) {
      return {
        text: [
          `Official Ritual documentation: ${AiService.OFFICIAL_DOCS_URL}`,
          `Overview page: ${AiService.OFFICIAL_OVERVIEW_URL}`,
        ].join('\n'),
        citations: [AiService.OFFICIAL_DOCS_URL, AiService.OFFICIAL_OVERVIEW_URL],
        usedRag: true,
        imagePath: attachWhatIsRitualImage ? this.whatIsRitualImagePath : undefined,
        imageUrl: docsContextImageUrl,
      };
    }

    if (whatIsRitualIntent) {
      return {
        text: [
          'Ritual is a blockchain project focused on expressive onchain AI execution and coordination.',
          'It is built to expand what users can do on-chain by connecting AI capabilities with crypto-native infrastructure.',
          `Official docs: ${AiService.OFFICIAL_OVERVIEW_URL}`,
        ].join('\n'),
        citations: [AiService.OFFICIAL_DOCS_URL, AiService.OFFICIAL_OVERVIEW_URL, AiService.OFFICIAL_SITE_URL],
        usedRag: uniqueSources.length > 0,
        imagePath: attachWhatIsRitualImage ? this.whatIsRitualImagePath : undefined,
        imageUrl: docsContextImageUrl,
      };
    }

    const contextText = relevantRetrieval
      .map((item, index) => `Source ${index + 1}: ${item.chunk.sourceUrl}\n${item.chunk.text}`)
      .join('\n\n');

    const systemPrompt = [
      'You are RITTY AI, a Discord assistant for Ritual community.',
      'Answer accurately and concisely.',
      'In this assistant, "Ritual" (including localized spellings like "ритуал") always refers to the Ritual project/ecosystem, never to generic cultural or religious rituals.',
      'If user asks about Ritual, provide project-specific information only.',
      'If source context is provided, ground your answer in it and do not hallucinate.',
      `If confidence is low, clearly say you are not sure and suggest official docs link: ${AiService.OFFICIAL_DOCS_URL}.`,
      'Only include source-based claims when context is provided.',
      `For Ritual documentation links, the canonical docs URL is ${AiService.OFFICIAL_DOCS_URL}.`,
      'Never invent or guess URLs/domains.',
      'Always answer in English.',
    ].join(' ');

    const userPrompt = contextText
      ? `User question:\n${question}\n\nContext:\n${contextText}`
      : `User question:\n${question}\n\nNo docs context was attached because this looks like a general question or low-relevance Ritual query.`;

    const historyInput = history.slice(-8).map((entry) => ({
      role: entry.role,
      content: entry.text.slice(0, 2000),
    }));

    const baseInput: OpenAI.Responses.ResponseCreateParams['input'] = [
      { role: 'system', content: systemPrompt },
      ...historyInput,
      { role: 'user', content: userPrompt },
    ];

    const response = await this.openai.responses.create({
      model: this.model,
      input: baseInput,
      ...(this.isGpt5Model() ? { reasoning: { effort: 'minimal' as const } } : {}),
      max_output_tokens: 800,
    });

    let rawText = this.extractResponseText(response);
    const incompleteReason = (response as { incomplete_details?: { reason?: string } }).incomplete_details?.reason;

    if (!rawText && incompleteReason === 'max_output_tokens') {
      const retry = await this.openai.responses.create({
        model: this.model,
        input: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `${userPrompt}\n\nReturn the final answer now. Do not output hidden reasoning.`,
          },
        ],
        ...(this.isGpt5Model() ? { reasoning: { effort: 'minimal' as const } } : {}),
        max_output_tokens: 1200,
      });
      rawText = this.extractResponseText(retry);
    }

    if (!rawText) {
      rawText = 'I could not produce an answer right now.';
    }

    let text = this.normalizeRitualUrls(rawText, likelyRitualQuestion);
    if (likelyRitualQuestion && this.looksLikeGenericRitualAnswer(text)) {
      text = [
        'Ritual here refers to the Ritual project (not generic cultural rituals).',
        'Ritual is a blockchain ecosystem focused on expressive onchain AI coordination and execution.',
        `Official docs: ${AiService.OFFICIAL_DOCS_URL}`,
      ].join('\n');
    }

    return {
      text,
      citations: uniqueSources.length > 0 ? uniqueSources : likelyRitualQuestion ? [AiService.OFFICIAL_DOCS_URL] : [],
      usedRag: relevantRetrieval.length > 0,
      imagePath: attachWhatIsRitualImage ? this.whatIsRitualImagePath : undefined,
      imageUrl: docsContextImageUrl,
    };
  }

  private async resolveDocsImageUrlForSources(sourceUrls: string[]): Promise<string | undefined> {
    const candidates = sourceUrls.filter((url) => /ritualfoundation\.org\/docs|ritual\.net/i.test(url)).slice(0, 4);
    for (const sourceUrl of candidates) {
      const cached = this.docsImageCache.get(sourceUrl);
      if (cached !== undefined) {
        if (cached) {
          return cached;
        }
        continue;
      }

      try {
        const response = await fetch(sourceUrl, {
          headers: {
            'user-agent': 'RITTY-AI-DocsImageResolver/1.0',
            accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(3500),
        });

        if (!response.ok) {
          this.docsImageCache.set(sourceUrl, null);
          continue;
        }

        const html = await response.text();
        const imageUrl = this.extractDocsImageUrlFromHtml(html, sourceUrl);
        this.docsImageCache.set(sourceUrl, imageUrl ?? null);
        if (imageUrl) {
          return imageUrl;
        }
      } catch {
        this.docsImageCache.set(sourceUrl, null);
      }
    }

    return undefined;
  }

  private extractDocsImageUrlFromHtml(html: string, pageUrl: string): string | undefined {
    const $ = load(html);
    const candidates: Array<{ url: string; score: number }> = [];
    const seen = new Set<string>();

    const pushCandidate = (rawValue: string | undefined, score: number) => {
      if (!rawValue) {
        return;
      }

      const normalizedRaw = this.decodeEscapedUrl(rawValue.trim());
      if (!normalizedRaw) {
        return;
      }

      const value =
        normalizedRaw.includes(',') && normalizedRaw.includes(' ')
          ? normalizedRaw
              .split(',')
              .map((item) => item.trim().split(/\s+/g)[0])
              .find(Boolean)
          : normalizedRaw.split(/\s+/g)[0];

      if (!value) {
        return;
      }

      try {
        const absolute = new URL(value, pageUrl).toString();
        const finalScore = this.scoreImageCandidate(absolute, score);
        if (this.isLikelyContentImageUrl(absolute) && finalScore > 0 && !seen.has(absolute)) {
          candidates.push({ url: absolute, score: finalScore });
          seen.add(absolute);
        }
      } catch {
        // ignore malformed URLs
      }
    };

    // Mintlify often keeps real section illustrations in preloaded image links.
    $('link[rel="preload"][as="image"]').each((_idx, el) => {
      pushCandidate($(el).attr('href'), 120);
    });

    // Strong signal: in-page illustration content.
    $('main img, article img').each((_idx, el) => {
      pushCandidate($(el).attr('src'), 200);
      pushCandidate($(el).attr('data-src'), 190);
      pushCandidate($(el).attr('srcset'), 190);
      pushCandidate($(el).attr('data-srcset'), 180);
    });

    // Fallback: any img on the page.
    $('img').each((_idx, el) => {
      pushCandidate($(el).attr('src'), 90);
      pushCandidate($(el).attr('data-src'), 80);
      pushCandidate($(el).attr('srcset'), 80);
      pushCandidate($(el).attr('data-srcset'), 70);
    });

    // Mintlify MDX source is embedded in scripts and often contains OptimizedImage src.
    for (const match of html.matchAll(/OptimizedImage[\s\S]{0,2000}?src:\s*\\?"([^"\\]+)\\?"/g)) {
      pushCandidate(match[1], 240);
    }
    for (const match of html.matchAll(/"data-path":\s*"([^"]+)"/g)) {
      const pathValue = match[1]?.trim();
      if (pathValue) {
        pushCandidate(pathValue, 210);
      }
    }

    const metaSelectors = [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[property="twitter:image"]',
    ];
    for (const selector of metaSelectors) {
      $(selector).each((_idx, el) => {
        pushCandidate($(el).attr('content'), 20);
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.url;
  }

  private isLikelyContentImageUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return false;
      }

      const value = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
      if (/\.ico(\?|$)/.test(value)) {
        return false;
      }

      // Avoid generated OG cards and UI assets, prefer real section illustrations.
      if (
        value.includes('/_mintlify/api/og') ||
        (value.includes('/_next/image') && parsed.search.toLowerCase().includes('api%2fog'))
      ) {
        return false;
      }

      if (/(logo|favicon|avatar|emoji|sprite|badge|banner-small|assets\/brand)/.test(value)) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  private decodeEscapedUrl(value: string): string {
    return value
      .replace(/\\u0026/g, '&')
      .replace(/\\u003d/g, '=')
      .replace(/\\u002f/g, '/')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  private scoreImageCandidate(url: string, baseScore: number): number {
    let score = baseScore;
    const lower = url.toLowerCase();

    if (lower.includes('/assets/images/')) {
      score += 160;
    }
    if (lower.includes('mintcdn.com/')) {
      score += 40;
    }
    if (lower.includes('/_mintlify/api/og') || (lower.includes('/_next/image') && lower.includes('api%2fog'))) {
      score -= 1000;
    }
    if (/(logo|icon|favicon|avatar|emoji|sprite|badge|assets\/brand)/.test(lower)) {
      score -= 300;
    }
    if (/\.svg(\?|$)/.test(lower) && !lower.includes('/assets/images/')) {
      score -= 120;
    }

    return score;
  }

  private isLikelyRitualQuestion(lowerQuestion: string, topScore: number): boolean {
    if (AiService.RITUAL_KEYWORDS.some((keyword) => lowerQuestion.includes(keyword))) {
      return true;
    }
    if (/\bритуал(а|у|ом|е|ы|ов|ам|ами|ах)?\b/u.test(lowerQuestion)) {
      return true;
    }
    return topScore >= 0.28;
  }

  private isDocsLinkIntent(lowerQuestion: string): boolean {
    if (lowerQuestion.length > 220) {
      return false;
    }
    const asksDocs = /(docs?|documentation|developer docs|документац|доки|official docs|документации)/u.test(lowerQuestion);
    const asksLink = /(link|url|where|где|ссылк|адрес)/u.test(lowerQuestion);
    const hasRitual = /(ritual|ритуал)/u.test(lowerQuestion);
    return hasRitual && asksDocs && asksLink;
  }

  private isCreativeRequest(lowerQuestion: string): boolean {
    return /(write|essay|poem|story|post|tweet|thread|draft|compose|напиши|сочинени|эссе|пост|твит|истори|придумай)/u.test(
      lowerQuestion,
    );
  }

  private normalizeRitualUrls(text: string, likelyRitualQuestion: boolean): string {
    if (!likelyRitualQuestion) {
      return text;
    }

    return text
      .replace(/https?:\/\/(?:www\.)?docs\.ritual\.ai(?:\/[^\s)\]]*)?/gi, AiService.OFFICIAL_DOCS_URL)
      .replace(/https?:\/\/(?:www\.)?ritual\.ai\/docs(?:\/[^\s)\]]*)?/gi, AiService.OFFICIAL_DOCS_URL);
  }

  private async shouldAttachWhatIsRitualImage(question: string): Promise<boolean> {
    if (!/\britual\b|ритуал/ui.test(question)) {
      return false;
    }

    if (this.isWhatIsRitualIntentHeuristic(question)) {
      return true;
    }

    try {
      const response = await this.openai.responses.create({
        model: this.model,
        ...(this.isGpt5Model() ? { reasoning: { effort: 'minimal' as const } } : {}),
        max_output_tokens: 16,
        input: [
          {
            role: 'system',
            content:
              'Classify intent. Return only YES or NO. YES when the user asks for the definition/overview/essence/purpose of Ritual in any language or paraphrase. NO for unrelated questions or specific subtopics.',
          },
          {
            role: 'user',
            content: question,
          },
        ],
      });

      const verdict = this.extractResponseText(response).toUpperCase();
      if (verdict.startsWith('YES')) {
        return true;
      }
      if (verdict.startsWith('NO')) {
        return false;
      }
    } catch {
      // fall back to local heuristic if classifier call fails
    }

    return this.isWhatIsRitualIntentHeuristic(question);
  }

  private isWhatIsRitualIntentHeuristic(question: string): boolean {
    const normalized = question
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const hasRitual = /\britual\b/.test(normalized);
    if (!hasRitual) {
      return false;
    }

    // Do not treat subtopic questions as "what is Ritual" definition intent.
    if (
      /\b(resonance|symphony|infernet|sidecar|sidecars|guardian|guardians|marketplace|architecture|roadmap|staking|token|node)\b/u.test(
        normalized,
      )
    ) {
      return false;
    }

    if (normalized === 'ritual' || normalized === 'what is ritual' || normalized === 'whats ritual') {
      return true;
    }

    const intentPatterns = [
      /\bwhat is\b/,
      /\bwhat s\b/,
      /\bwhat does ritual\b/,
      /\bexplain ritual\b/,
      /\bdefine ritual\b/,
      /\bintroduce ritual\b/,
      /\btell me about ritual\b/,
      /\boverview of ritual\b/,
      /что такое ritual/,
      /расскажи о ritual/,
      /que es ritual/,
      /qué es ritual/,
      /que e ritual/,
      /o que e ritual/,
      /o que é ritual/,
      /was ist ritual/,
      /was ist ein ritual/,
      /qu est ce que ritual/,
      /quest ce que ritual/,
      /c est quoi ritual/,
      /cos e ritual/,
      /cos è ritual/,
      /ritual nedir/,
      /ritual ne demek/,
      /ritualとは/,
      /ritual是什么/,
      /ritual是什麼/,
      /리추얼이 뭐야/,
    ];

    if (intentPatterns.some((pattern) => pattern.test(normalized))) {
      return true;
    }

    if (hasRitual && normalized.length <= 90 && /\?$/.test(question.trim())) {
      return true;
    }

    return false;
  }
}
