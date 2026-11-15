import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "../.work/src/i18n/locales/zh-CN";
if (!i18n.isInitialized)
  i18n.use(initReactI18next).init({
    lng: "zh-CN",
    fallbackLng: "zh-CN",
    resources: { "zh-CN": { translation: zh } },
    interpolation: { escapeValue: false },
  });
export default i18n;
