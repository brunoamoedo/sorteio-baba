# AGENTS

## Purpose
This repository is a Django/DRF backend plus a React/Vite frontend. This file helps AI coding agents understand the architecture, workflows, and where to look first.

## Project layout
- `backend/`: Django API-only backend, DRF, Celery, multi-tenant organization support.
- `frontend/`: React + TypeScript + Vite frontend.
- `docs/`: product requirements, business rules, implementation plan, and audit/bug notes.
- `docker-compose.yml`: local dev environment with PostgreSQL, Redis, backend, frontend, Celery worker, and beat.

## Backend conventions
- Python 3.13, Django 5.x, DRF, Celery.
- Shared code lives in `backend/common/` (`exceptions.py`, `mixins.py`, `models.py`, `pagination.py`, `permissions.py`).
- App boundaries are explicit: `accounts`, `players`, `matches`, `draws`, `statistics`, `audit`, `finance`.
- `apps/finance/` holds mensalidades **and** despesas. Four rules govern it (see `docs/REGRAS_DE_NEGOCIO.md` §14): competência ≠ payment date, historical amounts are frozen on the charge/expense, nothing is destroyed (cancel changes state and records who/when/why), and every relevant operation audits with `entity`/`entity_id`. Named capabilities live in `apps/finance/permissions.py`.
- Domain behavior is in `services.py` and `repositories.py` rather than views.
- Tests use `pytest` with `backend/pytest.ini` and `--reuse-db`.
- Key backend entry points:
  - `backend/manage.py`
  - `backend/config/settings/`
  - `backend/config/urls.py`
  - `backend/apps/*/views.py`, `services.py`, `serializers.py`, `models.py`

## Frontend conventions
- React 19, TypeScript 6, Vite, MUI, `react-hook-form`, `react-router-dom`, `axios`.
- Custom client-side data layer in `frontend/src/core/data/`:
  - `queryStore.ts`
  - `useApiQuery.ts`
  - `useApiMutation.ts`
  - `apiError.ts`
- API modules are in `frontend/src/api/*Api.ts`.
- Shared UI components and layout are under `frontend/src/shared/`:
  - `shared/theme/tokens.ts` is the single source for colour, radius, shadow and touch target. **No loose hex values in components.**
  - `shared/icons/index.ts` is the single icon map. Emoji is only kept where it is *content* (the WhatsApp message and the team identity markers), never as an action icon.
  - `shared/components/DataTable` swaps the table for a card list below `md` when given `renderCard` — that is how every listing works on a phone.
- The frontend is **mobile first**: 375px is the design target and the desktop is the enhancement. See `docs/DESIGN_SYSTEM.md`.
- Tests run on Vitest + Testing Library (jsdom), configured in `frontend/vitest.config.ts` with `frontend/src/test/setup.ts`. Test files live next to the code as `*.test.ts(x)`; coverage today is focused on the draw result screen (`src/features/matches/`).

## Important technical notes
- The frontend intentionally does not use React Query anymore; do not add `react-query` unless introducing a new feature with full justification.
- Multi-tenancy is important: backend organizations and permissions are a core part of the domain.
- The repo includes a local demo seed script at `backend/seed_demo.py`.
- The `docs/` folder contains useful product and bug context; prefer linking to these docs rather than duplicating them.

## Common commands
- Local dev via Docker Compose:
  - `docker-compose up --build`
  - **After adding or removing an npm dependency, `up --build` is NOT enough.** The frontend service mounts `/app/node_modules` as an anonymous volume, which survives rebuilds — the container keeps the old dependency tree and Vite fails with `Failed to resolve import "<pkg>"`, taking the whole app down. Drop the volume and rebuild that service only:
    - `docker compose rm -sfv frontend && docker compose up -d --build frontend`
    - Never `docker compose down -v` for this: that `-v` also destroys the `postgres_data` volume.
- Backend:
  - `cd backend && pip install -r requirements/dev.txt`
  - `cd backend && pytest -q`
  - `cd backend && ruff check .`
- Frontend:
  - `cd frontend && npm ci`
  - `cd frontend && npm run lint`
  - `cd frontend && npm run test`
  - `cd frontend && npm run build`

## CI behavior
- Backend job: Python 3.13, install `requirements/dev.txt`, run `ruff check .`, run `pytest -q`.
- Frontend job: Node 22, `npm ci`, `npm run lint`, `npm run test`, `npm run build`.
- Docker images are built in CI for backend and frontend.

## Useful docs
- `docs/REQUISITOS.md`
- `docs/REGRAS_DE_NEGOCIO.md`
- `docs/PLANO_IMPLEMENTACAO.md`
- `docs/AUDITORIA_BUGS.md`
- `docs/DESIGN_SYSTEM.md` — tokens, componentes compartilhados, alvo de toque, contraste e as regras de acessibilidade. **Leia antes de criar componente ou escolher cor.**
- `docs/PLANO_MOBILE_UX_SORTEIO.md` — o plano da evolução mobile-first / formações, com o checklist de execução.
