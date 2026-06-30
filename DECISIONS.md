# Decisiones Arquitectónicas (ADRs)

> Architectural Decision Records. Documentan **el porqué** de cada decisión técnica importante.
> Formato basado en [Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## Índice

- [ADR-001: Serverless (Lambda) sobre ECS Fargate](#adr-001-serverless-lambda-sobre-ecs-fargate)
- [ADR-002: Híbrido TypeScript + Python por contexto](#adr-002-híbrido-typescript--python-por-contexto)
- [ADR-003: 5 Bounded Contexts](#adr-003-5-bounded-contexts)
- [ADR-004: AWS SAM para empaquetar Lambdas](#adr-004-aws-sam-para-empaquetar-lambdas)
- [ADR-005: EventBridge como bus principal de eventos](#adr-005-eventbridge-como-bus-principal-de-eventos)
- [ADR-006: Coreografía + DLQ + idempotencia (sin orquestador)](#adr-006-coreografía--dlq--idempotencia-sin-orquestador)
- [ADR-007: JSON Schema como contratos de eventos](#adr-007-json-schema-como-contratos-de-eventos)
- [ADR-008: Aurora PostgreSQL con pgvector](#adr-008-aurora-postgresql-con-pgvector)
- [ADR-009: HTTP API Gateway v2 sobre REST API](#adr-009-http-api-gateway-v2-sobre-rest-api)
- [ADR-010: Monorepo con npm workspaces](#adr-010-monorepo-con-npm-workspaces)
- [ADR-011: Idempotencia por eventId en handlers async](#adr-011-idempotencia-por-eventid-en-handlers-async)

---

## ADR-001: Serverless (Lambda) sobre ECS Fargate

**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

El backend de Spark Match debe servir a una audiencia de tamaño piloto (TFP). La pregunta es si usar compute serverless (Lambda) o contenedores gestionados (ECS Fargate).

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Lambda** | Coste ~0 en baja carga, ops cero, auto-scaling | Cold start 200-400ms, timeout 15min |
| **ECS Fargate** | Sin cold start, contenedor long-lived | Coste mínimo ~$30/mes, requiere gestión |
| EC2 propio | Control total | Alto coste ops, antipatrón para TFP |

### Decisión

**AWS Lambda** para todo el backend.

### Consecuencias

**Positivas**:
- Coste operativo marginal en MVP (free tier cubre los primeros 1M requests/mes)
- Cero gestión de servidores, parches, capacity planning
- Auto-scaling transparente (de 0 a miles de invocaciones concurrentes)
- Pago por uso real

**Negativas**:
- Cold start penaliza la primera request (mitigado con provisioned concurrency si es crítico)
- Timeout de 15 min limita workflows largos (mitigado dividiendo en pasos async)
- Vendor lock-in a AWS (aceptable dado el contexto AWS-first)

**Mitigaciones**:
- **Provisioned Concurrency** solo para Lambdas críticas (chat con Bedrock) si el cold start duele
- Mantener dependencias mínimas (Lambda package <50MB)
- Runtime Node.js 20 / Python 3.12 (cold starts optimizados)

---

## ADR-002: Híbrido TypeScript + Python por contexto

**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

Cada Lambda puede escribirse en distintos lenguajes. La pregunta es si homogeneizar (todo TS o todo Python) o mezclar.

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Todo TypeScript** | Un solo lenguaje, mismo tooling | Ecosistema AI limitado (LangChain TS es secundario) |
| **Todo Python** | Ecosistema AI nativo | Frontend en Angular no comparte tipos |
| **Híbrido por contexto** | Cada contexto en su lenguaje ideal | Más complejidad operativa |

### Decisión

**Híbrido por contexto**:

- **TypeScript** para: Identity, Assessment, Career (CRUD, validación, auth)
- **Python** para: Matching, AI Advisor (cómputo numérico, Bedrock, embeddings)

### Consecuencias

**Positivas**:
- TypeScript comparte tipos con el frontend Angular (Zod schemas → form validators)
- Python usa directamente el SDK de Bedrock, LangChain, pgvector (sin ports inmaduros)
- Cada equipo trabaja con su stack preferido

**Negativas**:
- Dos toolchains (npm + uv/pip)
- Contratos de eventos deben ser agnósticos al lenguaje (justifica ADR-007 JSON Schema)

**Mitigaciones**:
- Lambda Layers separados por runtime (`python-runtime`, `node-runtime`)
- CI matrix por lenguaje

---

## ADR-003: 5 Bounded Contexts

**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

El dominio Spark Match tiene varios subdominios. ¿Cuántos contextos definir?

### Opciones consideradas

| # Contextos | Ejemplo | Trade-off |
|---|---|---|
| 3 | Identity+Profile, Assessment+Matching, AI Advisor | Simple, pero contextos se vuelven "mini-monolitos" |
| **5** | Identity, Assessment, Career, Matching, AI Advisor | Balance claridad/complejidad |
| 8 | Separar RAG, Notif, Analytics como contextos | Más puro DDD, excesivo para TFP |

### Decisión

**5 contextos principales** + Notifications como contexto cross-cutting (event handlers puros, sin API).

### Consecuencias

**Positivas**:
- Cada contexto cabe en la cabeza de un dev (~2-3 Lambdas)
- Lenguaje ubicuo claro por contexto
- Deploys independientes viables

**Negativas**:
- Más boilerplate inicial (5 carpetas `contexts/`, 5 dominios)
- Notificaciones distribuidas entre varios contextos si se necesita UI

**Mitigaciones**:
- Templates SAM por contexto que se importan al template principal
- Notifications UI se implementa como vista agregada que lee DynamoDB

---

## ADR-004: AWS SAM para empaquetar Lambdas

**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

Hay que definir cómo declarar y desplegar las Lambdas. Las opciones principales son SAM, CDK, Terraform, Serverless Framework.

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **SAM** | AWS-native, `sam local`, simple para Lambdas | Sintaxis YAML declarativa, no programática |
| CDK | Type-safe, programático | Paradigma diferente a Terraform ya usado |
| Terraform | Consistencia con 02-infrastructure | Sin `sam local`, packaging manual |
| Serverless Framework | Multi-cloud | Vendor extra, menos idiomático |

### Decisión

**SAM** para definir todas las Lambdas + API Gateway. **Terraform** se mantiene para infra persistente (VPC, RDS, S3, IAM, Cognito, Secrets Manager, SSM Parameters).

### Consecuencias

**Positivas**:
- `sam local invoke` y `sam local start-api` para testing sin AWS
- Definiciones concisas (`AWS::Serverless::Function` resuelve role, log group, tracing automáticamente)
- Capas (Layers) declarativas

**Negativas**:
- Dos herramientas (SAM + Terraform)
- SAM no soporta rollback nativo en deploy

**Mitigaciones**:
- Contrato claro: Terraform = infra persistente, SAM = código serverless
- Deploy de Terraform PRIMERO, luego SAM (lee SSM outputs)

---

## ADR-005: EventBridge como bus principal de eventos

**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

Necesitamos un bus para comunicación asíncrona entre contextos. Opciones: SNS, SQS, EventBridge, Kafka.

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **EventBridge** | Schema discovery, archive, reglas declarativas | Latencia ~500ms (vs SNS inmediato) |
| SNS | Simple, fan-out rápido | Sin schemas, sin reglas de filtrado |
| SQS | Cola durable, retries | 1-a-1, sin fan-out nativo |
| Kafka (MSK) | Potente, ordenado | Costo elevado, ops complejo |

### Decisión

**EventBridge** como bus principal. Bus custom `spark-match-events`. SQS solo como DLQ de las reglas.

### Consecuencias

**Positivas**:
- Schema discovery automático para nuevos eventos
- Archive (30 días) permite replay para nuevos consumidores
- Reglas filtran por `source`, `detail-type`, contenido del payload
- Integración nativa con CloudWatch metrics

**Negativas**:
- Latencia ligeramente mayor que SNS (aceptable para eventos de dominio)
- Costo: $1/million events (gratis hasta cierto límite)

---

## ADR-006: Coreografía + DLQ + idempotencia (sin orquestador)

**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

Cuando un evento dispara varios pasos (ej: AssessmentCompleted → Matching → Notification), ¿cómo coordinamos?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Coreografía pura** | Simple, sin coordinador central | Difícil ver el flujo completo |
| Coreografía + DLQ + idempotencia | Resiliente, recuperable | Más código en cada handler |
| Orquestación con Step Functions | Visualización clara, retries nativos | Más infra, vendor lock-in |

### Decisión

**Coreografía + SQS DLQ por regla + idempotencia por `eventId`**.

### Consecuencias

**Positivas**:
- Sin punto único de fallo (coordinador)
- Cada handler es independiente y testeable en aislamiento
- Fallos van a DLQ para inspección/reproceso manual

**Negativas**:
- El flujo end-to-end se reconstruye solo leyendo logs/traces
- Requiere disciplina de idempotencia en cada handler

**Mitigaciones**:
- X-Ray activo para trace cross-context
- CloudWatch dashboard con flow visualizado manualmente
- Regla global: handler que falla 3 veces → DLQ + alerta

---

## ADR-007: JSON Schema como contratos de eventos

**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

Productores y consumidores hablan lenguajes diferentes (TS vs Py). ¿Cómo garantizamos que el payload es válido?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **JSON Schema + ajv/jsonschema** | Agnóstico al lenguaje, ecosistema maduro | Verbosos, dos librerías a mantener |
| TypeScript types + Pydantic | Tipado en cada lado | Productor/consumidor pueden divergir silenciosamente |
| AWS EventBridge Schema Registry | Menos código, auto-descubrimiento | Acopla más a AWS |
| Protobuf | Compacto, tipado | Requiere generadores, overkill para JSON |

### Decisión

**JSON Schema draft-07** en `shared/contracts/<context>/<event>.v<N>.json`. Validación con `ajv` (TS) y `jsonschema` (Py) en cada handler antes de procesar.

### Consecuencias

**Positivas**:
- Una sola fuente de verdad del contrato
- Validación en runtime detecta drift entre productor y consumidor
- Versionado explícito (`v1`, `v2`)
- Schemas publicables para consumidores externos

**Negativas**:
- Overhead de parsear y validar en cada handler (~ms)
- Mantenimiento: añadir campo → actualizar schema + versión si breaking

---

## ADR-008: Aurora PostgreSQL con pgvector

**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

Necesitamos almacenar datos relacionales (usuarios, carreras, assessments) + embeddings para RAG. ¿Una sola BD o varias?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Aurora PG + pgvector** | Una BD, JOINs cross-schema, embeddings en el mismo motor | Requiere disciplina de schemas lógicos |
| Aurora PG + OpenSearch | Lo mejor de cada mundo | Costo ~$100/mes OpenSearch |
| RDS MySQL + Pinecone | MySQL familiar | Vendor externo, datos fuera de AWS |
| DynamoDB + FAISS | Serverless-native | No relacional, JOINs manuales |

### Decisión

**Aurora PostgreSQL Serverless v2** con extensión `pgvector`. Schemas lógicos por contexto (`identity`, `assessment`, `career`, `matching`, `ai`).

### Consecuencias

**Positivas**:
- Una sola BD que sirve relacional + vectores
- JOINs cross-schema posibles (con moderación, solo para vistas)
- pgvector es open-source, sin vendor lock-in
- Backups, replication gestionados por Aurora

**Negativas**:
- Si un contexto abusa, puede leer/escribir schemas ajenos (mitigado por CODEOWNERS + tests)
- Aurora Serverless v2 tiene mínimo de capacidad (ACU) configurable

**Mitigaciones**:
- CODEOWNERS impide PR cross-schema sin review de los equipos afectados
- Tests automatizados verifican que cada Lambda solo accede a su schema
- GRANTs en Postgres limitan permisos por rol

---

## ADR-009: HTTP API Gateway v2 sobre REST API

**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

API Gateway tiene dos versiones: REST (v1) y HTTP (v2). ¿Cuál usar?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **HTTP API v2** | $1/M requests, JWT nativo, menor latencia | Menos features (no usage plans, no API keys granulares) |
| REST API v1 | Features completas (throttling, usage plans, caching) | $3.50/M requests, mayor latencia |

### Decisión

**HTTP API v2** para todo el tráfico público. REST API solo si en el futuro se necesita API keys por partner.

### Consecuencias

**Positivas**:
- Coste 3.5x menor en tráfico alto
- Latencia ~10ms menor por request
- JWT authorizer nativo (integra con Cognito o Lambda authorizer)
- CORS más simple

**Negativas**:
- Sin API keys built-in (mitigable con Lambda authorizer custom)
- Sin usage plans (no necesario para TFP)

---

## ADR-010: Monorepo con npm workspaces

**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

5 bounded contexts + shared kernel + tests. ¿Un repo o varios?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Monorepo con workspaces** | Tipos compartidos, contratos sincronizados, un deploy | Repo crece, requiere CI inteligente |
| Polyrepo (uno por contexto) | Aislamiento total, deploys independientes | N repos que coordinar, refactor cross-context imposible |
| Monorepo sin workspaces | Más simple | No resuelve compartir tipos |

### Decisión

**Monorepo único** (`spark-match-03-backend`) con **npm workspaces** para TS y **uv** para Python. Estructura:

```
03-backend/
├── shared/           # Shared kernel
├── contexts/         # 5 bounded contexts
├── layers/           # Lambda layers
└── tests/
```

### Consecuencias

**Positivas**:
- Contratos de eventos (`shared/contracts/`) evolucionan atómicamente
- Tipos compartidos entre contextos vía workspaces (`@spark-match/shared`)
- Un solo `sam deploy` para todo
- CI corre tests de todos los contextos en paralelo

**Negativas**:
- Repo puede crecer (mitigado: layers se cachean, tests en CI son incrementales)
- Un PR puede tocar múltiples contextos (mitigado: CODEOWNERS notifica a cada equipo)

---

## ADR-011: Idempotencia por eventId en handlers async

**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

EventBridge garantiza *at-least-once* delivery. Un handler async puede recibir el mismo evento dos veces. ¿Cómo evitamos procesamiento duplicado?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Idempotency table (DynamoDB)** | Rápido, TTL automático, sin infra extra | Costo mínimo por escritura |
| Idempotency en BD de dominio | Sin infra extra | Acopla el handler al dominio |
| Sin idempotencia (acepta duplicados) | Simple | Riesgo de emails dobles, métricas infladas |

### Decisión

**Tabla DynamoDB `spark-match-event-idempotency`**:

- Key: `eventId` (partition key)
- TTL: 7 días (suficiente para retries de EventBridge)
- Escritura condicional (`attribute_not_exists`) para evitar race conditions
- Si el `eventId` ya existe → handler retorna 200 sin procesar

### Consecuencias

**Positivas**:
- Procesamiento exactly-once a nivel práctico
- Tabla barata (~$0.01/mes para el volumen del TFP)
- Patrón uniforme para todos los handlers async

**Negativas**:
- Una llamada extra a DynamoDB por evento (~5ms)
- Tabla adicional a gestionar (mínimo: TTL + retention)

**Mitigaciones**:
- Batch writes si el volumen sube
- CloudWatch alarm si `ConsumedWriteCapacityUnits` se dispara (señal de retries masivos)

---

## Plantilla para nuevas ADRs

```markdown
## ADR-NNN: Título corto

**Estado**: Propuesto | Aceptado | Deprecado | Superseded by ADR-XXX
**Fecha**: YYYY-MM-DD

### Contexto

[Qué problema estamos resolviendo. 1-3 párrafos.]

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| ... | ... | ... |

### Decisión

[Qué elegimos. 1-2 oraciones.]

### Consecuencias

**Positivas**: ...

**Negativas**: ...

**Mitigaciones**: ...
```