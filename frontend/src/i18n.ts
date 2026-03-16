/** next-intl client-only configuration for static export (Cloudflare Pages). */

import { getRequestConfig } from "next-intl/server";

/** Active locales — add back from ALL_LOCALES when ready to expand. */
export const SUPPORTED_LOCALES = ["ko", "en"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Default fallback — English for all non-Korean browsers. */
export const DEFAULT_LOCALE: SupportedLocale = "en";

export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  ko: "한국어",
  en: "English",
};

/** Full locale list — uncomment entries in SUPPORTED_LOCALES to re-enable. */
// export const ALL_LOCALES = ["ko", "en", "fr", "es", "de", "it", "hi", "zh", "ja"] as const;
// export const ALL_LOCALE_NAMES = {
//   ko: "한국어", en: "English", fr: "Français", es: "Español",
//   de: "Deutsch", it: "Italiano", hi: "हिन्दी", zh: "中文", ja: "日本語",
// };

/** Dynamically load messages for a given locale. */
export async function loadMessages(locale: string) {
  try {
    return (await import(`./messages/${locale}.json`)).default;
  } catch {
    return (await import("./messages/en.json")).default;
  }
}

export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    messages: await loadMessages(locale),
  };
});
