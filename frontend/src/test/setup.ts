import '@testing-library/jest-dom'

﻿import '@testing-library/jest-dom'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ru from '../i18n/locales/ru.json'
import en from '../i18n/locales/en.json'

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: 'ru',
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
})
import 'fake-indexeddb/auto'
