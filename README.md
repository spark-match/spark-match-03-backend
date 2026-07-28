# Spark Match Backend

> **Serverless DDD+EDA monolith** built on AWS Lambda + TypeScript (Node.js).
> The Python AI Advisor lives in the sibling repo [`spark-match-08-deep-agent`](../spark-match-08-deep-agent/) (Python + LangChain + AWS Bedrock).
>
> _Last verified against `spark-match-01-devops@main` (PR #117, 26 Jul 2026): SonarCloud CI improvements active — fail-loud on QG timeout, cached `~/.sonar`, architecture sensor skipped._
> _Dependency snapshot (PR #55, 28 Jul 2026): TypeScript 6, Node.js 24, vitest 4, ESLint 10, Zod 4, jose 6.2.4._

[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-green.svg)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/Vitest-4-yellow.svg)](https://vitest.dev/)
[![AWS SAM](https://img.shields.io/badge/AWS-SAM-orange.svg)](https://aws.amazon.com/serverless/sam/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)

## 📋 Quick links

- **Architecture**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **ADRs (architectural decisions)**: [docs/DECISIONS.md](docs/DECISIONS.md)
- **Event catalog**: [docs/EVENT_CATALOG.md](docs/EVENT_CATALOG.md)
- **Folder structure**: [docs/FOLDER_STRUCTURE.md](docs/FOLDER_STRUCTURE.md)
- **Observability guide**: [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md)
- **High-level decisions**: [../BACKEND.md](../BACKEND.md) (root level)

## 🚀 Quick start

### Prerequisites

- Node.js 24+ (`node --version`)
- AWS SAM CLI 1.151+ (`sam --version`)
- AWS CLI configured with `spark-match-prod` profile

### Install

```bash
npm install
npm run build:shared
```

### Test

```bash
npm test                  # all unit tests
npm run test:watch        # watch mode
npm run test:coverage     # with coverage report
```

### Lint + Typecheck

```bash
npm run lint              # eslint
npm run typecheck         # tsc --noEmit
npm run format            # prettier --write
```

### Build Lambda Layers

```bash
npm run layer:build:all
```

### Local development

```bash
# In one terminal: start API Gateway + Lambda emulators
npm run local:api

# In another: invoke a specific function
sam local invoke IdentityRegisterFunction -e events/register.json
```

### Deploy

```bash
# Dev (default)
sam build && sam deploy

# Specific environment
sam deploy --config-env prod
```

## 🏗️ Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│  HTTP API Gateway v2 (REST-style, JWT-validated)            │
└────┬──────────────────┬──────────────────┬──────────────────┘
     │                  │                  │
     ▼                  ▼                  ▼
┌──────────┐      ┌──────────┐       ┌──────────┐
│ Identity │      │Assessment│       │  Career  │  ← TypeScript Lambdas
│  (TS)    │      │   (TS)   │       │   (TS)   │
└────┬─────┘      └────┬─────┘       └────┬─────┘
     │                  │                  │
     ▼                  ▼                  ▼
   ┌──────────────────────────────────────┐
   │  EventBridge bus (spark-match-events)│  ← EDA
   └───┬──────────┬──────────┬────────────┘
       │          │          │
       ▼          ▼          ▼
┌─────────┐  ┌──────┐  ┌─────────┐
  │Matching │  │Notif │  │  AI     │  ← TypeScript Lambdas + cross-cutting handlers
  │  (TS)   │  │  (TS)  │  │ Advisor │
  └─────────┘  └──────┘  └─────────┘
                             │
                             │ (HTTP, no in this repo)
                             ▼
                      ┌────────────────┐
                      │ 08-deep-agent  │  ← Separate repo, AgentCore Runtime
                      │ (FastAPI +     │
                     │  LangGraph)    │
                     └────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## 📂 Folder structure

```
03-backend/
├── package.json              # npm workspaces (root)
├── tsconfig.base.json        # TypeScript config (strict mode)
├── template.yaml             # SAM template (root orchestrator)
├── samconfig.toml            # SAM config per environment
├── eslint.config.mjs         # ESLint 10 (flat config)
├── .prettierrc               # Prettier
├── vitest.config.mts         # Test runner (vitest 4)
│
├── shared/                   # @spark-match/shared (npm workspace)
│   ├── src/
│   │   ├── auth/             # JWT (jose), password hash (scrypt)
│   │   ├── http/             # ApiResponse, ApiError
│   │   ├── logger/           # Powertools Logger wrapper
│   │   ├── events/           # EventBridge client, schema validator
│   │   ├── infra/            # SSM reader, Secrets reader
│   │   └── templates/        # buildHandler() pattern
│
├── layers/                   # Lambda Layers
│   ├── node-shared/          # Compiled shared/ utilities
│   └── node-runtime/         # zod, middy, powertools, kysely, pg, jose
│
├── contexts/                 # Bounded Contexts (TypeScript)
│   └── identity/             # auth, users, profiles
│
├── migrations/               # node-pg-migrate SQL files (V001+)
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md          # ADR index
│   ├── adr/                  # One file per ADR (Nygard template)
│   ├── EVENT_CATALOG.md
│   ├── FOLDER_STRUCTURE.md
│   └── OBSERVABILITY.md
│
└── .github/
    ├── CODEOWNERS            # Per-context ownership
    ├── dependabot.yml        # Weekly npm updates
    ├── workflows/
    │   ├── ci.yml
    │   └── deploy.yml
    └── pull_request_template.md
```

Note: this repo is TypeScript only. The Python AI Advisor lives in
[`spark-match-08-deep-agent`](../spark-match-08-deep-agent/).

## 🎯 Team

| Role | Owners |
|---|---|
| **Backend** | `@spark-match/backend-devs` (ahincho, dbarretol) |
| **AI / ML** | `@spark-match/ai-devs` (ahincho, nikolaiasencios) |
| **DevOps** | `@spark-match/devops` (ahincho, dbarretol) |
| **Product** | `@spark-match/product-owners` (ahincho, dbarretol, Fabiola) |

## 📊 Status (Fase 1)

| Fase | Alcance | Estado |
|---|---|---|
| 0 | Documentación | ✅ |
| **1** | **Scaffold + Identity context** | **🚧 En progreso** |
| 2 | Shared kernel completo + tests | ⏳ |
| 3 | Lambda Layers production-ready | ⏳ |
| 4 | Assessment context | ⏳ |
| 5 | Career context | ⏳ |
| 6 | Matching context | ⏳ |
| 7 | Notifications + observability | ⏳ |
| 8 | E2E integration tests | ⏳ |

## 📝 License

MIT — see [LICENSE](../LICENSE)
