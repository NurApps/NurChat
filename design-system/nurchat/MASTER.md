# Design System Master — NurChat (human, не иишный)

> Когда строишь страницу, сперва читай этот файл. Если есть `design-system/nurchat/pages/<page>.md` — его правила переопределяют мастер.

**Project:** NurChat — E2E messenger (Tauri + React + Rust)
**Style goal:** тёплый, человечный, современный, не «сгенерировано ИИ». Избегаем холодных градиентов, перфекционизма ИИ, Inter везде, и стеклянных неонов. Вместо этого — бумажная теплота, мягкие скругления, живая типографика, спокойные микровзаимодействия.
**Generated:** 2026-09-15

---

## 1. Pattern — Messaging Focused

- **Layout:** двухпанельный messenger (Sidebar 304–360px + Chat). Sidebar — список чатов/контакты с лёгкой сепарацией, главный чат — мягкая бумажная сцена, композер липкий.
- **Иерархия:** аватар → имя → превью → время/бейдж. Одно действие на строку (hover → меню). Не нагружаем карточками.
- **Пустые состояния:** не центрированная иллюстрация-gradient, а тёплый paper-блок с рукописным акцентом (Caveat для заголовка) + конкретная подсказка «Начните с поиска @username».

## 2. Style — Soft Human Minimalism

**Направление:** Soft UI Evolution (WCAG AA+) + Nature Distilled теплота + капля Anti-Polish (несовершенный край, бумажный шум). Сдержанно.

- **Ключевые маркеры НЕ-ИИ:** тёплый paper-фон вместо чистого #fff, текст pencil-black #2D2D2D вместо #000, скругления 14–18px с лёгкой асимметрией пузыря, органические тени (множественные мягкие, не размытый неон), зерно 0.06.
- **Avoid:** стеклянный морфизм, радужные градиенты, одинаковый radius 8px везде, Inter-only, эмодзи как иконки, center-иллюстрации из ИИ.

## 3. Colors — Warm Paper + Messenger Blue

| Роль | Hex | Токен | Примечание |
|------|-----|-------|------------|
| Background paper | `#FDFBF7` | `--bg` | тёплая бумага, не #fff |
| Surface | `#FFFFFF` | `--surface` | карточки/бар |
| Surface hover | `#F5F0E8` | `--surface-variant` | тёплый hover |
| Foreground | `#2D2D2D` | `--text-primary` | Pencil Black — мягче #000 |
| Secondary text | `#6B6B6B` | `--text-secondary` | тёплый серый |
| Border / divider | `#E8E0D0` / `#EFE9DC` | `--border` `--divider` | песочный, не холодный |
| Primary (messenger) | `#2563EB` | `--tg-blue` | доверие, оставляем |
| Primary hover | `#1D4ED8` | `--tg-blue-hover` | |
| Primary soft | `#E8F0FE` | `--tg-blue-soft` | фон mine-пузыря |
| Online green | `#0F9D6A` | `--tg-green` | теплее #059669 |
| Warm accent | `#C67B5C` | `--accent-warm` | терракота для редких акцентов |
| Destructive | `#DC2626` | `--error` | |
| Shadow | `0 4px 16px rgba(45,45,45,0.06)` | `--shadow-soft` | |

**Dark** — тёплый тёмный, не холодный #0d1117: `--bg: #141210`, `--surface: #1E1C1A`, `--surface-variant: #292622`, `--text-primary: #E8E0D0`, `--border: #2E2A26`, тени 0 4px 20px rgba(0,0,0,0.35).

## 4. Typography — Soft Rounded Human

- **Heading (имена, тайтлы):** `Varela Round` 500–600, 15–18px, tracking -0.01em. Человечный округлый, не editorial Calistoga.
- **Body (сообщения, инпуты):** `Nunito Sans` 400–600, 15.5px / 1.45, оптически крупнее Inter, дружелюбнее.
- **Mono (время, meta):** `JetBrains Mono` 400, 11–12px, tracking 0.02em.
- **Accent (пустые состояния, рукопись):** `Caveat` 600 только для 1 заголовка на экран (22–26px) — капля рукописности, не весь UI.

Google Fonts: `Varela Round + Nunito Sans + Caveat + JetBrains Mono`
```css
@import url('https://fonts.googleapis.com/css2?family=Varela+Round&family=Nunito+Sans:wght@400;500;600;700&family=Caveat:wght@600&family=JetBrains+Mono:wght@400&display=swap');
```

## 5. Spacing & Radii — organic, не идеальные 8px

| Токен | Значение | Применение |
|-------|----------|------------|
| `--space-xs` | 4px | иконка-текст |
| `--space-sm` | 8px | внутренние гэпы |
| `--space-md` | 14px | паддинг пузыря/карточки |
| `--space-lg` | 20px | секция |
| `--space-xl` | 28px | отступы сцены |
| `--radius-bubble-mine` | `18px 18px 4px 18px` | органическая асимметрия mine |
| `--radius-bubble-other` | `18px 18px 18px 4px` | other |
| `--radius-card` | `16px` | sidebar item, модалка |
| `--radius-input` | `20px` | композер |
| `--radius-pill` | `999px` | бейджи |

## 6. Shadows & Grain

- **Soft:** `0 2px 8px rgba(45,45,45,0.07)` — карточки, пузыри other (белая подложка).
- **Medium:** `0 4px 16px rgba(45,45,45,0.06)` — sidebar, header.
- **Grain:** `background-image: radial-gradient(rgba(45,45,45,0.04) 1px, transparent 1px); background-size: 14px 14px; opacity 0.5` на `.chat-messages` — едва заметная бумага.

## 7. Motion — спокойный, человеческий

- **Micro:** 180ms `cubic-bezier(0.2,0,0,1)` — hover, появление пузыря `translateY(4px) → 0` + fade 180ms (не 150ms generic).
- **No:** scale 1.02 на ховер карточках, стеклянные параллаксы.
- **Respect:** `prefers-reduced-motion` — отключает grain и translate.

## 8. Components — messenger-specific

- **Sidebar item:** 56px высота, 12px паддинг, 14px radius, hover `#F5F0E8` с 180ms, селект — мягкая заливка `#E8F0FE` + синяя левая полоска 3px.
- **Bubble mine:** фон `#E8F0FE` (не WhatsApp #dcf8c6 — слишком AI-клише), текст `#2D2D2D`, тень soft, radius асимметричный. `other`: `#FFFFFF` + border `#EFE9DC`.
- **Composer:** pill-input `#FFFFFF` + border `#E8E0D0`, focus — border `#2563EB` + soft ring `0 0 0 3px #2563EB14`, кнопка send — синяя окружность 38px, иконка 18px, hover 1.03 scale (не 1.05).
- **Avatar:** 40–48px, фон — тёплая палитра по хешу имени (не только синий), border 2px paper.

## 9. Anti-patterns (НЕ делать)

- ❌ Чистый #fff фон везде + Inter 14px + radius 8px + синий primary — выглядит как шаблон ИИ.
- ❌ Градиентный hero / стеклянные карточки / неоновые акценты.
- ❌ Эмодзи как иконки (🎨) — только Phosphor/Heroicons outline 1.5px.
- ❌ Одинаковые perfect shadows и scale-hover 1.02 на каждом элементе.
- ❌ Центрированная ИИ-иллюстрация в empty state.

## 10. Checklist перед сдачей

- [ ] Фон бумаги тёплый, не #fff; grain едва заметен, отключается при reduced-motion
- [ ] Шрифты Varela Round / Nunito Sans подключены, Inter не доминирует
- [ ] Пузыри с асимметричным радиусом, mine #E8F0FE, other #FFFFFF+border
- [ ] Hover 180ms ease-out, без layout-shift
- [ ] Иконки Phosphor outline, 44pt hitSlop
- [ ] Контраст 4.5:1 в light и dark, dark тёплый
- [ ] Empty states с Caveat + конкретным действием
- [ ] 375px проверен, скролл не под tab bar
