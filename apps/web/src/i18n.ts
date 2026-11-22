import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const languages = { en: "English", fr: "Français" } as const;
export type Language = keyof typeof languages;

const stored = localStorage.getItem("language");
const browser = navigator.language.slice(0, 2);
const initial = [stored, browser].find((l): l is Language => !!l && l in languages) ?? "en";

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, fr: { translation: fr } },
    lng: initial,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });

i18n.on("languageChanged", (language) => {
  localStorage.setItem("language", language);
  document.documentElement.lang = language;
});
document.documentElement.lang = initial;

export default i18n;
