# Orbit

A project collaboration app for individuals and small student teams. Keep tasks, discussions, and deliverables together for coursework, competitions, and software projects.

[简体中文](README.md) · [Documentation](docs/README.md) · [Deployment](docs/AWS-MICRO-DEPLOYMENT.md)

## Features

- Create projects, invite teammates through single-use links, manage members, and archive completed projects.
- Search and filter task lists and a three-column board, with assignees, priorities, due dates, drag-and-drop, and menu alternatives.
- Collaborate through Markdown descriptions, subtasks, comments, private attachments, and project activity.
- Track assigned work in a personal dashboard, restore deleted tasks, and handle editing conflicts with draft protection.
- Email registration, verification, password recovery, and account timezone settings.

The interface is in Simplified Chinese, with desktop and mobile support for core workflows. Project permissions are enforced on the server.

## Try it

After starting the app, open the [read-only demo](http://localhost:3000/demo). It uses synthetic data and needs no login or database seed.

For real collaboration, register, verify your email in [Mailpit](http://localhost:8025), create a project, and share an invitation link with a teammate.

## Getting started

Requires Node.js 24+, pnpm 10.34.5, and running Docker Compose.

```sh
git clone https://github.com/liaboveall/Orbit.git
cd Orbit
npm install -g pnpm@10.34.5
pnpm install --frozen-lockfile
```

1. Copy `.env.example` to `.env.local`: `Copy-Item .env.example .env.local` in PowerShell, or `cp .env.example .env.local` on macOS/Linux.
2. Generate a local secret and set `BETTER_AUTH_SECRET` in `.env.local`:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Start the local services:

   ```sh
   docker compose -f infra/compose.dev.yml up -d
   ```

4. Open the [MinIO console](http://localhost:9001), sign in with the local storage credentials from `.env.example`, and create the private bucket `orbit-dev`, matching `STORAGE_BUCKET`.
5. Apply committed migrations and start Orbit:

   ```sh
   pnpm db:migrate:deploy
   pnpm dev
   ```

Open [Orbit](http://localhost:3000) and register an account. Optional `pnpm db:seed` creates development fixtures, not a login account. Never commit local credentials. See the [environment guide](docs/08-ENVIRONMENT-AND-DEPLOYMENT.md) for port overrides and test database setup.

## Development

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build / server |
| `pnpm check` | Lint, application types, unit and contract tests |
| `pnpm typecheck:scripts` | Tool script types |
| `pnpm test:integration` | PostgreSQL integration tests |
| `pnpm test:e2e` / `pnpm test:ui` | Browser workflows / UI tests |
| `pnpm db:migrate:dev` | Create development migrations |
| `pnpm db:migrate:deploy` | Apply committed migrations |

Run database and browser suites sequentially against the separate `orbit_test` database. See [test instructions](tests/README.md).

## Stack and structure

Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, and Radix UI; PostgreSQL 17, Prisma 7, Better Auth, and private S3-compatible storage. Exact versions are in [package.json](package.json) and the lockfile.

- `src/app`: pages and API routes.
- `src/features`: frontend product features.
- `src/server`: authentication, authorization, persistence, and business services.
- `src/contracts` and `contracts`: runtime validation and OpenAPI.
- `prisma`, `tests`, and `infra`: migrations, verification, and deployment.

## Deployment and status

Orbit runs as a persistent Node.js container. The [AWS guide](docs/AWS-MICRO-DEPLOYMENT.md) and [operations manual](docs/M6-OPERATIONS.md) cover PostgreSQL, private storage, email, HTTPS, and backups.

Core collaboration features are implemented and locally verified. Production deployment and external acceptance remain in progress; the AI project planning assistant is not implemented. [PROGRESS](PROGRESS.md) and the [backlog](planning/backlog.json) track current evidence and remaining work. Engineering documentation is primarily in Chinese.
