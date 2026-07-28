# ADR-013: Stack Middy + Zod + Lambda Powertools (NO NestJS/Spring/Quarkus)


**Estado**: Aceptado · **Fecha**: 2026-07-06
**Relacionado**: `D:\UNI\Spark\BACKEND.md` (Decisión 6)

### Contexto

Spark Match necesita un framework para escribir Lambdas que tenga la DX de NestJS/Spring Boot
(DI, validación, middleware, logging, tracing, métricas) pero adaptado al modelo serverless
short-lived de AWS Lambda.

### Opciones consideradas

| Opción | Bundle size | Cold start | Build time | Veredicto |
|---|---|---|---|---|
| **NestJS** (completo) | ~3-5 MB | ~800-1500ms | ~60s | ❌ Solo con Provisioned Concurrency (cuesta) |
| **Quarkus JVM** | ~50 MB | ~1000-2000ms | ~30s | ❌ Peor, JVM pesa |
| **Quarkus Native** | ~20 MB | ~50-200ms | **~5-10 min** | 🟡 Mejor cold start pero mata la productividad |
| **Spring Boot** | ~30 MB | ~2000-3000ms | ~30s | ❌ Antipatrón en Lambda |
| **Middy + Zod + Powertools** | **~50-200 KB** | **~100-200ms** | **~10s** | ✅ Hecho para esto |

### Decisión

**Stack Middy**:
- **Middy** (middleware chain) — reemplaza NestJS Interceptors / Spring Filters
- **Zod** (validación TS-first) — reemplaza class-validator / Bean Validation, genera tipos con `z.infer<>`
- **Lambda Powertools** (Logger, Tracer, Metrics, Parameters, Idempotency) — AWS-native
- **Kysely** (SQL tipado) — reemplaza TypeORM / Hibernate
- **esbuild** (bundling) — vía SAM CLI 1.30+
- **Vitest** (testing) — más rápido que Jest
- **Composition root pattern** (manual DI) — sin decoradores
- **`@asteasolutions/zod-to-openapi`** — para generar OpenAPI desde schemas Zod

### Consecuencias

**Positivas**:
- Bundle size 4-25x más pequeño que alternativas JVM/Node frameworks
- Cold start 5-15x más rápido
- Costo AWS: ~$0-6/mes (free tiers cubren)
- DX consistente con prácticas de AWS
- Idempotencia built-in (Powertools)

**Negativas**:
- Sin DI automática (composition root manual)
- Sin decoradores para routing (API GW routes en YAML)
- OpenAPI generation más inmadura (zod-to-openapi)

**Mitigaciones**:
- Composition root: archivo por contexto con un solo `buildContext()` que arma todas las deps
- API GW routing: ya es declarativo en `template.yaml`, no es code-heavy
- OpenAPI: schema Zod + endpoint script que genera `docs/openapi.json`

---

