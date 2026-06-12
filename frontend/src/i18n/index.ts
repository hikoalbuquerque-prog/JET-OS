// src/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import pt from './pt.json';
import es from './es.json';
import en from './en.json';
import ru from './ru.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      pt: { translation: pt },
      es: { translation: es },
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: localStorage.getItem('appLang') || 'pt',
    fallbackLng: 'pt',
    interpolation: { escapeValue: false },
  });

export default i18n;
