import { Agent, setGlobalDispatcher } from 'undici';
import { logger } from '../logger.js';

let configured = false;

export function configureUndiciForRender(): void {
  if (configured) {
    return;
  }

  // Render + Cloudflare can intermittently close pooled sockets.
  // Use short-lived connections and disable pipelining for stability.
  const dispatcher = new Agent({
    pipelining: 0,
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
    connect: {
      family: 4,
      timeout: 30_000,
    },
  });

  setGlobalDispatcher(dispatcher);
  configured = true;
  logger.info('Configured undici dispatcher for stable Discord/OpenAI requests');
}
