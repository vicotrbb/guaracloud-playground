# Guara Cloud Playground

Playground repository with hello world examples for every framework and language supported by [Guara Cloud](https://guara.cloud).

Each folder contains a minimal, deployable hello world project — backend projects return `{"message": "Hello from <tech>!"}` on `GET /`, and frontend projects render a simple page.

## Backend APIs

| Folder | Language/Framework | Type |
|---|---|---|
| `go/` | Go (net/http) | API |
| `python-flask/` | Python (Flask) | API |
| `java-spring-boot/` | Java (Spring Boot) | API |
| `ruby-sinatra/` | Ruby (Sinatra) | API |
| `dotnet/` | .NET 8 (Minimal API) | API |
| `php/` | PHP | API |
| `express/` | Node.js (Express) | API |
| `fastify/` | Node.js (Fastify) | API |
| `nestjs/` | Node.js (NestJS) | API |
| `koa/` | Node.js (Koa) | API |
| `hapi/` | Node.js (Hapi) | API |

## Full-Stack / SSR

| Folder | Framework | Type |
|---|---|---|
| `nextjs/` | Next.js | Full-stack |
| `nuxt/` | Nuxt | Full-stack |
| `remix/` | Remix | Full-stack |
| `sveltekit/` | SvelteKit | Full-stack |

## Static Frontend

| Folder | Framework | Type |
|---|---|---|
| `astro/` | Astro | Static |
| `vite-react/` | Vite + React | Static |
| `create-react-app/` | Create React App | Static |
| `gatsby/` | Gatsby | Static |
| `angular/` | Angular | Static |

## Deployment

All projects are designed to work with Guara Cloud's three build methods:

- **Buildpack** (recommended) — Paketo auto-detects the language/framework
- **Dockerfile** — Bring your own Dockerfile
- **Image** — Deploy a pre-built container image

Each project listens on the `PORT` environment variable (defaults to `8080`).
