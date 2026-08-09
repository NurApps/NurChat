# NurChat Mobile

> Android & iOS клиенты на Tauri v2 Mobile

## Архитектура

```
mobile/
├── android/          ← Tauri v2 Android (Kotlin/NDK)
├── ios/              ← Tauri v2 iOS (Swift)
├── docs/             ← Документация по mobile
├── scripts/          ← Скрипты сборки
├── MOBILE_PLAN.md    ← План мобильного приложения
└── README.md         ← Этот файл
```

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
