// KMX EDC — i18n system (lightweight, no external deps)
import { createContext, useContext } from "react";
import ko, { type Translations } from "./ko";
import en from "./en";

export type Locale = "ko" | "en";

export const LOCALES: Record<Locale, { label: string; flag: string }> = {
  ko: { label: "한국어", flag: "🇰🇷" },
  en: { label: "English", flag: "🇺🇸" },
};

const translations: Record<Locale, Translations> = { ko, en };

export function getTranslations(locale: Locale): Translations {
  return translations[locale];
}

export interface I18nContextType {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
}

export const I18nContext = createContext<I18nContextType>({
  locale: "ko",
  t: ko,
  setLocale: () => {},
});

export function useI18n() {
  return useContext(I18nContext);
}

export type { Translations };
