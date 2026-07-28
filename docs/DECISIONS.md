# Architectural Decision Records (ADRs)

> Source of truth for **why** each significant technical decision was made.
> Format based on [Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
>
> One ADR per file under `docs/adr/`. Status legend: **Aceptado**, **Propuesto**, **Deprecado**, **Superseded by ADR-NNN**.

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [ADR-001](adr/001-serverless-lambda-over-ecs-fargate.md) | Serverless (Lambda) sobre ECS Fargate | Aceptado | 2026-06-30 |
| [ADR-002](adr/002-hybrid-typescript-python-by-context.md) | Híbrido TypeScript + Python por contexto | **Deprecado** (2026-07-28: este repo es TS-only) | 2026-06-30 / 2026-07-28 |
| [ADR-003](adr/003-5-bounded-contexts.md) | 5 Bounded Contexts | Aceptado | 2026-06-30 |
| [ADR-004](adr/004-aws-sam-for-lambda-packaging.md) | AWS SAM para empaquetar Lambdas | Aceptado | 2026-06-30 |
| [ADR-005](adr/005-eventbridge-as-primary-event-bus.md) | EventBridge como bus principal de eventos | Aceptado | 2026-06-30 |
| [ADR-006](adr/006-choreography-dlq-idempotency.md) | Coreografía + DLQ + idempotencia (sin orquestador) | Aceptado | 2026-06-30 |
| [ADR-007](adr/007-json-schema-as-event-contracts.md) | JSON Schema como contratos de eventos | Aceptado | 2026-06-30 |
| [ADR-008](adr/008-aurora-postgresql-pgvector.md) | Aurora PostgreSQL con pgvector | Aceptado (reconsiderado 2026-07-13) | 2026-06-30 / 2026-07-13 |
| [ADR-009](adr/009-http-api-gateway-v2-over-rest.md) | HTTP API Gateway v2 sobre REST API | Aceptado | 2026-06-30 |
| [ADR-010](adr/010-monorepo-with-npm-workspaces.md) | Monorepo con npm workspaces | Aceptado | 2026-06-30 |
| [ADR-011](adr/011-idempotency-by-event-id.md) | Idempotencia por eventId en handlers async | Aceptado | 2026-06-30 |
| [ADR-012](adr/012-hybrid-backend-lambda-plus-python-server.md) | Backend híbrido — Lambda (Node/Py) + servidor Python dedicado | **Deprecado parcialmente** (2026-07-28: Lambda Python → Lambda TS; AI Advisor sigue en repo separado) | 2026-07-06 / 2026-07-28 |
| [ADR-013](adr/013-middy-zod-powertools-stack.md) | Stack Middy + Zod + Lambda Powertools (NO NestJS/Spring/Quarkus) | Aceptado | 2026-07-06 |
| [ADR-014](adr/014-observability-with-powertools-not-otel.md) | Observabilidad con Powertools (NO OpenTelemetry) | Aceptado | 2026-07-06 |

## How to add a new ADR

1. Pick the next sequential number (e.g. `015`).
2. Create `docs/adr/015-my-decision.md` using the template below.
3. Add a row to the index table above.
4. Open a PR. `@spark-match/product-owners` approves governance-impacting ADRs; `@spark-match/backend-devs` approves the rest.

## Template

```markdown
# ADR-NNN: Titulo corto

**Estado**: Propuesto | Aceptado | Deprecado | Superseded by ADR-XXX
**Fecha**: YYYY-MM-DD

## Contexto

[Que problema estamos resolviendo. 1-3 parrafos.]

## Opciones consideradas

| Opcion | Pros | Contras |
|---|---|---|
| ... | ... | ... |

## Decision

[Que elegimos. 1-2 oraciones.]

## Consecuencias

**Positivas**: ...

**Negativas**: ...

**Mitigaciones**: ...
```
