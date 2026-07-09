# Contributing to NurChat

Спасибо за интерес к NurChat! Вот как начать.

## Development Setup

### Требования
- Python 3.10+
- Node.js 22+
- Rust (для Tauri)
- Git

### Быстрый старт

```bash
# Клонируем
git clone https://github.com/NurApps/NurChat_desktop_beta.git
cd NurChat_desktop

# Python venv
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt

# Frontend
cd frontend
npm install
cd ..

# Запуск сервера
python -m uvicorn server.main:app --port 8000 --reload

# Запуск Tauri (отдельный терминал)
npx tauri dev
```

## Project Structure

```
├── frontend/           # React + TypeScript
├── server/             # FastAPI + SQLAlchemy
├── shared/             # Общие конфиги
├── src-tauri/          # Rust Tauri backend
└── alembic/            # DB миграции
```

## Code Style

### Python
- FastAPI + SQLAlchemy
- Pydantic для валидации
- async/await для I/O
- Logger через `logging` модуль

### TypeScript/React
- Functional components + hooks
- TypeScript strict mode
- CSS (без Tailwind)
- Vite для сборки

### Rust
- Tauri v2
- `tokio` для async
- `serde` для сериализации

## Pull Requests

1. Fork репозиторий
2. Создай ветку `feature/имя-фичи`
3. Сделай изменения
4. Проверь: `cd frontend && npm run build`
5. Отправь PR с описанием изменений

## Issues

Используй шаблоны:
- **Bug Report** — для багов
- **Feature Request** — для новых фич

## License

AGPL-3.0 — все контрибьюции под этой лицензией.
