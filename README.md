# Spark Match Backend

> **Serverless DDD+EDA monolith** built on AWS Lambda + TypeScript + Python.
> Hybrid architecture: Lambda for CRUD/EDA, dedicated Python server for the AI Advisor (in [`08-deep-agent`](../08-deep-agent/)).

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.12-blue.svg)](https://www.python.org/)
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

- Node.js 20+ (`node --version`)
- Python 3.12+ (`python --version`)
- AWS SAM CLI 1.151+ (`sam --version`)
- uv 0.11+ (`uv --version`)
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
  │Matching │  │Notif │  │  AI     │  ← Python Lambdas + cross-cutting handlers
  │  (Py)   │  │      │  │ Advisor │
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
├── pyproject.toml            # Python deps (uv/pip)
├── .eslintrc.cjs             # ESLint
├── .prettierrc               # Prettier
├── ruff.toml                 # Python linter
├── vitest.config.ts          # Test runner
│
├── shared/                   # @spark-match/shared (npm workspace)
│   ├── src/
│   │   ├── auth/             # JWT decode, password hash
│   │   ├── http/             # ApiResponse, ApiError
│   │   ├── logger/           # Powertools Logger wrapper
│   │   ├── events/           # EventBridge client, schema validator
│   │   ├── infra/            # SSM reader, Secrets reader
│   │   └── templates/        # buildHandler() pattern
│   └── tests/
│
├── layers/                   # Lambda Layers
│   ├── node-shared/          # Compiled shared/ utilities
│   └── node-runtime/         # zod, middy, powertools, kysely, pg
│
├── contexts/                 # 5 Bounded Contexts
│   ├── identity/             # TS - auth, users, profiles
│   ├── assessment/           # TS - RIASEC, Big Five
│   ├── career/               # TS - careers catalog
│   └── matching/             # Python - affinity, scoring
│
├── events/                   # Cross-cutting event handlers
│   ├── notifications/        # emails via SES
│   └── analytics/            # ETL to S3
│
├── tests/
│   ├── unit/
│   ├── integration/          # LocalStack + testcontainers
│   └── contract/             # JSON Schema validation
│
├── scripts/
│   ├── seed-db.py
│   ├── publish-schemas.ts
│   └── deploy-all.sh
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md
│   ├── EVENT_CATALOG.md
│   ├── FOLDER_STRUCTURE.md
│   └── OBSERVABILITY.md
│
└── .github/
    ├── CODEOWNERS            # Per-context ownership
    ├── workflows/
    │   ├── ci.yml
    │   └── deploy.yml
    └── pull_request_template.md
```

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
| 6 | Matching context (Python Lambda) | ⏳ |
| 7 | Notifications + observability | ⏳ |
| 8 | E2E integration tests | ⏳ |

## 📝 License

MIT — see [LICENSE](../LICENSE)
