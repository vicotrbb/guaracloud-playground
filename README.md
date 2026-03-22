# Guara Cloud Playground

Test repository for [Guara Cloud](https://guaracloud.com) — a cloud platform for deploying applications. This repo contains minimal, deployable projects across every supported framework and language, used to validate the platform's build pipeline, deployment, logging, storage, and compute capabilities.

Each folder is a self-contained project that can be deployed independently.

All projects listen on the `PORT` environment variable (defaults to `8080`).

---

## Test Projects

Purpose-built projects that exercise specific platform capabilities (storage, compute, logging).

| Folder | Stack | Purpose | Env Vars | Port |
|---|---|---|---|---|
| `java-stress-test/` | Java (Spring Boot) | CPU stress test via prime number computation. `GET /?limit=N` computes primes up to N (default 1M, max 50M). Tests compute scaling and resource limits. | `PORT` | 8080 |
| `go-pvc-test/` | Go (net/http) | Key-value store backed by a JSON file on disk. Tests PVC/persistent storage. `GET /` lists items, `POST /` creates items, `GET /items/:id` reads, `DELETE /items/:id` deletes. | `PORT`, `STORAGE_PATH` (directory for data.json) | 8080 |
| `express-crud-test/` | Node.js (Express + SQLite) | Contact list CRUD app with a static HTML frontend and SQLite database. Tests PVC/persistent storage and full-stack serving. | `PORT`, `DB_PATH` (path to SQLite file) | 8080 |
| `php-random-test/` | PHP | Returns a random number on each request using a manual LCG algorithm (no library). Logs every generated number. Tests logging pipeline. | `PORT` | 8080 |

---

## Hello World Projects

Minimal hello world apps — backend APIs return `{"message": "Hello from <tech>!"}` on `GET /`, frontend apps render a centered heading.

### Backend APIs

| Folder | Stack | Port |
|---|---|---|
| `go/` | Go (net/http) | 8080 |
| `python-flask/` | Python (Flask + Gunicorn) | 8080 |
| `java-spring-boot/` | Java (Spring Boot) | 8080 |
| `ruby-sinatra/` | Ruby (Sinatra + Puma) | 8080 |
| `dotnet/` | .NET 8 (Minimal API) | 8080 |
| `php/` | PHP (built-in server) | 8080 |
| `express/` | Node.js (Express) | 8080 |
| `fastify/` | Node.js (Fastify) | 8080 |
| `nestjs/` | Node.js (NestJS) | 8080 |
| `koa/` | Node.js (Koa) | 8080 |
| `hapi/` | Node.js (Hapi) | 8080 |

### Full-Stack / SSR

| Folder | Stack | Port |
|---|---|---|
| `nextjs/` | Next.js 15 | 8080 |
| `nuxt/` | Nuxt 3 | 8080 |
| `remix/` | Remix 2 (Vite) | 8080 |
| `sveltekit/` | SvelteKit 2 | 8080 |

### Static Frontend

| Folder | Stack | Port |
|---|---|---|
| `astro/` | Astro 5 | 8080 |
| `vite-react/` | Vite 6 + React 19 | 8080 |
| `create-react-app/` | Create React App | 8080 |
| `gatsby/` | Gatsby 5 | 8080 |
| `angular/` | Angular 19 | 8080 |

---

## Deployment

All projects are designed to work with Guara Cloud's three build methods:

- **Buildpack** (recommended) — Paketo auto-detects the language/framework
- **Dockerfile** — Bring your own Dockerfile
- **Image** — Deploy a pre-built container image
