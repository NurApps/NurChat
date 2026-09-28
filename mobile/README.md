# NurChat Mobile

> Android & iOS клиенты на Tauri v2 Mobile

## Архитектура

```
mobile/
├── android/          ← Tauri v2 Android (Kotlin/NDK, после `cargo tauri android init`)
├── ios/              ← Tauri v2 iOS (Swift, после `cargo tauri ios init`)
├── assets/           ← Готовые иконки приложения (единый знак, см. scripts/generate_icons.py)
│   ├── ic_launcher_foreground.png + ic_launcher_background.xml ← Android adaptive icon
│   ├── ios-appicon-1024.png         ← iOS App Store (1024, без прозрачности)
│   └── store-icon-512.png           ← Google Play (512)
├── docs/             ← Документация по mobile
├── scripts/          ← Скрипты сборки
└── README.md         ← Этот файл
```

> WebView mobile-клиента использует тот же frontend, что и desktop:
> иконка вкладки/PWA — `frontend/public/favicon.svg`, `icon-192/512.png`,
> `manifest.webmanifest`. Отдельных мобильных логотипов нет — знак один везде.

## Быстрый старт

```bash
# 1. Инициализация Android
cd src-tauri
cargo tauri android init

# 2. Инициализация iOS (нужен macOS)
cargo tauri ios init

# 3. Dev на эмуляторе
cargo tauri android dev

# 4. Build release
cargo tauri android build
```

## Требования

- **Android:** Android Studio + SDK 26+ (8.0+), JDK 17
- **iOS:** Xcode 15+, macOS, Apple Developer account
- **Tauri CLI:** `cargo install tauri-cli`

## Структура mobile-специфичных компонентов

```
frontend/src/
├── components/
│   ├── mobile/
│   │   ├── BottomTabs.tsx       ← Навигация снизу
│   │   ├── SwipeableRow.tsx     ← Свайп влево/вправо
│   │   ├── PullToRefresh.tsx    ← Потянуть для обновления
│   │   ├── MobileMessageInput.tsx ← Поле ввода (touch-optimized)
│   │   └── MobileMediaViewer.tsx  ← Просмотр медиа (swipe to close)
│   └── ...
├── styles/
│   ├── mobile.css               ← Mobile-specific стили
│   └── responsive.css           ← Media queries
└── hooks/
    └── useMobile.ts             ← Хук определения платформы
```

## Mobile vs Desktop фичи

| Фича | Desktop | Mobile | Реализация |
|------|---------|--------|------------|
| Навигация | Sidebar слева | Bottom Tabs | `BottomTabs.tsx` |
| Удаление | Delete key | Swipe left | `SwipeableRow.tsx` |
| Поиск | Ctrl+K | Pull down | `PullToRefresh.tsx` |
| Медиа | Click | Tap + swipe | `MobileMediaViewer.tsx` |
| Звонки | Windowed | Fullscreen | Native WebRTC |
| Push | ❌ | FCM/APNs | `tauri-plugin-notification` |
| Biometric | ❌ | Face ID/Fingerprint | `tauri-plugin-biometric` |
| Share | Copy link | Share sheet | Intent/Share extension |

## Метрики

- Cold start: < 2 сек
- APK: < 30MB
- IPA: < 40MB
- Battery drain (background): < 3% за ночь
- Crash-free sessions: > 99.5%
