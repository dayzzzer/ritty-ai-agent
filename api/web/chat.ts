import { getServices } from '../_shared.js';
import { processWebChat, type WebChatRequest } from '../../src/web/server.js';

interface RequestLike {
  method?: string;
  body?: unknown;
}

interface ResponseLike {
  status: (code: number) => {
    json: (body: unknown) => void;
  };
}

function normalizeBody(body: unknown): WebChatRequest {
  if (!body) {
    return {};
  }

  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as WebChatRequest;
    } catch {
      return {};
    }
  }

  if (typeof body === 'object') {
    return body as WebChatRequest;
  }

  return {};
}

export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const services = await getServices();
    const payload = normalizeBody(req.body);
    const result = await processWebChat(payload, services);
    res.status(200).json(result);
  } catch (error) {
    console.error('api/web/chat error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
