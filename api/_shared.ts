import { BotServices } from '../src/services/botServices.js';

let servicesPromise: Promise<BotServices> | null = null;

export async function getServices(): Promise<BotServices> {
  if (!servicesPromise) {
    servicesPromise = (async () => {
      const services = new BotServices();
      await services.loadDocsIndex();
      return services;
    })();
  }

  return servicesPromise;
}
