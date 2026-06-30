# Spark Match Backend

> Backend serverless del proyecto **Spark Match** — copiloto de orientación vocacional con IA Generativa.
> Documento vivo. Cambios sustantivos se registran en [DECISIONS.md](./DECISIONS.md).

## Documentación

| Doc | Contenido |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Diseño completo: bounded contexts, patrones de comunicación, storage, observabilidad |
| [EVENT_CATALOG.md](./EVENT_CATALOG.md) | Catálogo de eventos de dominio con JSON Schemas v1 |
| [DECISIONS.md](./DECISIONS.md) | ADRs (Architectural Decision Records) |
| [FOLDER_STRUCTURE.md](./FOLDER_STRUCTURE.md) | Convenciones del monorepo, naming, cómo añadir Lambdas/eventos/contextos |

## Stack (resumen)

- **Compute**: AWS Lambda (Node.js 20 + Python 3.12)
- **API**: HTTP API Gateway v2
- **Event bus**: EventBridge (bus custom `spark-match-events`)
- **DB**: Aurora PostgreSQL Serverless v2 + pgvector
- **Packaging**: AWS SAM
- **Estilo**: DDD + EDA + Serverless
- **Estructura**: Monorepo con 5 bounded contexts

## Bounded Contexts

1. **Identity** (TypeScript) — usuarios, perfiles, auth
2. **Assessment** (TypeScript) — tests RIASEC + Big Five
3. **Career** (TypeScript) — catálogo de carreras
4. **Matching** (Python) — cálculo de afinidad, recomendaciones
5. **AI Advisor** (Python) — chat con Bedrock, RAG

## Estado del proyecto

| Fase | Descripción | Estado |
|---|---|---|
| 0 | Documentación de arquitectura | ✅ En revisión |
| 1 | Scaffold mínimo (template, configs, CI) | ⏳ Pendiente |
| 2 | Shared Kernel (domain base, EventBridge client, JSON Schemas) | ⏳ Pendiente |
| 3 | Identity Context end-to-end | ⏳ Pendiente |
| 4 | AI Advisor Context end-to-end (Bedrock) | ⏳ Pendiente |
| 5 | Career + Assessment contexts | ⏳ Pendiente |
| 6 | Matching Context + event handlers async | ⏳ Pendiente |
| 7 | Observabilidad completa (X-Ray, dashboards) | ⏳ Pendiente |

## Quickstart (cuando esté implementado)

```bash
# Instalar deps
npm install
uv sync

# Tests
npm test
uv run pytest

# Build + deploy local
sam build
sam local start-api

# Deploy a prod (requiere approval)
sam deploy --config-env prod
```

## Licencia

MIT — ver [LICENSE](./LICENSE).