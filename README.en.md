<div align="center">
  <img src="src/app/icon.svg" width="72" height="72" alt="">
  <h1>Orbit</h1>
  <p><strong>Know who's doing what and what comes next.</strong></p>
  <p>A workspace for coursework, hackathons, and small software projects.<br>Keep tasks, conversations, and files together.</p>
  <p>
    <a href="https://smartorbit.tech/demo"><strong>Try the live demo ↗</strong></a>
    &nbsp;·&nbsp;
    <a href="https://smartorbit.tech">Open Orbit</a>
    &nbsp;·&nbsp;
    <a href="README.md">简体中文</a>
  </p>
</div>

[![Orbit's desktop board and mobile task details showing a fictional campus project](docs/media/orbit-showcase.png)](https://smartorbit.tech/demo)

<p align="center"><sub>Captured from the public demo, which uses sample data and requires no account. The app interface is in Simplified Chinese.</sub></p>

## From assignment to delivery

- **See what’s moving.** Organize work in a board or list, with assignees, priorities, and deadlines. Move cards by dragging or with the keyboard menu.
- **Collaborate in context.** Invite teammates with single-use links. Add Markdown descriptions, subtasks, comments, and private attachments.
- **Find your next task.** See assigned work and deadlines across projects. Keep drafts when edits conflict and recover deleted tasks from the trash.

## Run locally

Use **Node.js 24+**, **pnpm 10.34.5**, and **Docker Compose**. Clone the repository, then install dependencies and generate a local secret from the repository root.

~~~sh
pnpm install --frozen-lockfile
cp .env.example .env.local
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
~~~

On Windows PowerShell, use `Copy-Item .env.example .env.local`. Set `BETTER_AUTH_SECRET` in `.env.local` to the generated value before starting the local services and app.

~~~sh
docker compose -f infra/compose.dev.yml up -d --wait
pnpm db:migrate:deploy
pnpm dev
~~~

Open [localhost:3000](http://localhost:3000). Verification emails appear in [Mailpit](http://localhost:8025). The read-only [/demo](http://localhost:3000/demo) is available immediately.

## Repository

| Directory | Contents |
| --- | --- |
| `src/` | Next.js pages and APIs, feature UI, authorization and domain services |
| `prisma/` · `contracts/` | PostgreSQL schema, migrations, and the OpenAPI contract |
| `infra/` · `scripts/` | Containers, reverse proxy, maintenance and backups |
| `tests/` | Unit, contract, integration and browser regression tests |

**Stack**　Next.js · React · TypeScript · Tailwind CSS · PostgreSQL · Prisma · Better Auth · S3

[Architecture and API](docs/README.md) · [Deploy and restore](docs/OCI-DEPLOYMENT.md) · [Run tests](tests/README.md)
