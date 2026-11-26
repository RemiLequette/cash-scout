import { useTranslation } from "react-i18next";

/** Languages offered for a book's reference data. Any BCP 47 tag is accepted by the API. */
const bookLanguages = ["en", "fr", "es", "de", "it", "pt", "nl", "ms", "zh", "ar"];

export function languageOptions(displayLocale: string) {
  const names = new Intl.DisplayNames([displayLocale], { type: "language" });
  return bookLanguages.map((code) => ({ value: code, label: `${names.of(code)} (${code})` }));
}

export function currencyOptions(displayLocale: string) {
  const names = new Intl.DisplayNames([displayLocale], { type: "currency" });
  return Intl.supportedValuesOf("currency").map((code) => ({
    value: code,
    label: `${code} – ${names.of(code)}`,
  }));
}

/** The 12 month names in the interface language. */
export function useMonthNames(style: "short" | "long") {
  const { i18n } = useTranslation();
  return Array.from({ length: 12 }, (_, m) =>
    new Intl.DateTimeFormat(i18n.language, { month: style, timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, m, 1)),
    ),
  );
}
