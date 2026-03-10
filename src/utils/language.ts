export type SupportedLocale = 'ru' | 'en';

export function detectLocaleFromText(text: string): SupportedLocale {
  void text;
  return 'en';
}

export function localize(locale: SupportedLocale, ru: string, en: string): string {
  void locale;
  void ru;
  return en;
}
