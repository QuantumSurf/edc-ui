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

/**
 * 임의의 문자열/null 을 유효한 Locale 로 정규화한다. 미지값("de")·프로토타입
 * 키("toString")·falsy 는 전부 기본 "ko" 로 떨어뜨린다.
 * localStorage 의 "locale" 은 외부 조작·구버전 잔존값으로 무효일 수 있어,
 * `as Locale` 캐스트만 믿으면 getTranslations 가 undefined 를 반환해 흰 화면이 된다.
 */
export function normalizeLocale(value: string | null | undefined): Locale {
  return value && Object.prototype.hasOwnProperty.call(translations, value)
    ? (value as Locale)
    : "ko";
}

/**
 * 어떤 입력에도 절대 undefined 를 반환하지 않는다(무효 locale → ko).
 * 최후 안전망인 ErrorBoundary 폴백도 이 함수를 거치므로, 여기서 흰 화면 벡터를
 * 원천 차단한다. hasOwnProperty 로 프로토타입 키까지 막는다.
 */
export function getTranslations(locale: Locale): Translations {
  return Object.prototype.hasOwnProperty.call(translations, locale)
    ? translations[locale]
    : ko;
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
