# Arquitectura del Backend — Spark Match

> Documento vivo. Cambios sustantivos se registran en [DECISIONS.md](./DECISIONS.md).

## 1. Resumen ejecutivo

El backend de **Spark Match** está diseñado como una aplicación **serverless** construida sobre los principios de **Domain-Driven Design (DDD)** y **Event-Driven Architecture (EDA)**.

| Aspecto | Decisión |
|---|---|
| Estilo arquitectónico | DDD + EDA + Serverless |
| Compute | AWS Lambda (Node.js 20 + Python 3.12) |
| API | HTTP API Gateway v2 |
| Event bus | EventBridge (bus custom `spark-match-events`) |
| Persistencia | Aurora PostgreSQL Serverless v2 + pgvector |
| Packaging | AWS SAM (Lambdas) + Terraform (infra) |
| Lenguajes | TypeScript (CRUD, auth) + Python (IA/ML, data) |
| Estructura | Monorepo con workspaces |

## 2. Drivers arquitectónicos

Las decisiones se tomaron en función de estos atributos de calidad (priorizados):

| Prioridad | Atributo | Implicación |
|---|---|---|
| 1 | **Mantenibilidad** | Separación clara de responsabilidades por contexto |
| 2 | **Evolucionabilidad** | Contextos despliegan de forma independiente |
| 3 | **Coste** | Serverless con pay-per-use, sin infraestructura ociosa |
| 4 | **Time-to-market** | MVP viable en semanas, no meses |
| 5 | **Performance** | Cold start aceptable (<500ms) para TFP |
| 6 | **Observabilidad** | Trazabilidad cross-context vía X-Ray |

## 3. Estilo: DDD + EDA + Serverless

### 3.1 Por qué DDD

El dominio de Spark Match tiene **subdominios naturales** bien diferenciados:

- Identidad y perfil de usuario
- Evaluación vocacional (RIASEC, personalidad)
- Catálogo de carreras
- Motor de matching (afinidad perfil ↔ carrera)
- Asesor IA (chat, RAG)

Sin DDD, estos subdominios tienden a mezclarse en un "monolito modular" que degenera en acoplamiento. Con DDD, cada uno tiene:

- **Lenguaje ubicuo** propio (términos con significado preciso en cada contexto)
- **Modelo de dominio** aislado (Aggregates, Value Objects)
- **Fronteras explícitas** (bounded contexts)

### 3.2 Por qué EDA

Una vez separados los contextos, la pregunta es **cómo se comunican sin acoplarse**. Las opciones son:

| Mecanismo | Acoplamiento | Veredicto |
|---|---|---|
| Llamada HTTP directa entre Lambdas | Alto (sincrónico, frágil) | ❌ |
| SNS topic compartido | Medio (fire-and-forget) | 🟡 |
| **EventBridge + eventos de dominio** | **Bajo (async, schema-versioned)** | ✅ |
| DynamoDB Streams | Bajo (acopla al storage) | 🟡 |

EventBridge permite:

- **Desacoplamiento temporal**: productores y consumidores no necesitan estar vivos a la vez
- **Versionado de esquemas**: evolución backward-compatible
- **Filtrado declarativo**: reglas por `source`, `detail-type`, contenido del payload
- **Replay**: archive permite reprocesar eventos para nuevos consumidores
- **Auditoría**: cada evento queda registrado con su metadata

### 3.3 Por qué Serverless

Para una aplicación de **baja/media carga** (TFP con usuarios piloto), serverless es objetivamente superior:

| Aspecto | Serverless (Lambda) | Contenedores (ECS Fargate) |
|---|---|---|
| Coste con baja carga | ~$0 (free tier cubre MVP) | ~$30/mes mínimo (cluster activo) |
| Coste con picos | Auto-escala a 0 | Requiere over-provisioning |
| Cold start | 200-400ms (Node/Py) | N/A (warm) |
| Ops | Cero (AWS gestiona runtime) | Parches, scaling, networking |
| Madurez AWS | +10 años, estable | +10 años, estable |

Para Spark Match, serverless gana en **coste** y **operacional**. La penalización de cold start es aceptable para una aplicación de orientación vocacional (no es tiempo-real crítico).

## 4. Bounded Contexts

### 4.1 Mapa de contextos

```
┌─────────────────────────────────────────────────────────────────────┐
│                    API Gateway (HTTP API v2)                        │
└───────┬──────────┬──────────┬──────────┬──────────┬─────────────────┘
        │          │          │          │          │
        ▼          ▼          ▼          ▼          ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
   │Identity │ │Assessment│ │ Career  │ │Matching │ │AI Advisor│
   │  (TS)   │ │  (TS)    │ │  (TS)   │ │  (Py)   │ │  (Py)    │
   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
        │          │           │           │           │
        ▼          ▼           ▼           ▼           ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Aurora PostgreSQL + pgvector  (5 schemas, 1 por ctx)  │
   └─────────────────────────────────────────────────────────┘
                               │
                               │ writes → emiten Domain Events
                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │  EventBridge Bus: spark-match-events                    │
   │  Archive: 30 días │ Schema discovery: ON                │
   └────┬────────────────────────────────────────────────────┘
        │
        ▼
   ┌─────────────────────────────────────────────────────────┐
   │  SQS DLQ (por regla) → Event handlers (async Lambdas)  │
   └─────────────────────────────────────────────────────────┘
```

### 4.2 Responsabilidades por contexto

#### Identity Context (TypeScript)

- **Responsabilidad**: alta y gestión de usuarios, perfiles, sesiones.
- **Aggregates**: `User`, `Session`, `Profile`
- **API síncrona**: `POST /v1/auth/register`, `POST /v1/auth/login`, `GET /v1/users/me`, `PATCH /v1/users/me`
- **Eventos emitidos**: `UserRegistered`, `UserLoggedIn`, `ProfileUpdated`
- **Storage**: schema `identity` en Aurora (`users`, `sessions`, `profiles`)

#### Assessment Context (TypeScript)

- **Responsabilidad**: cuestionarios RIASEC + personalidad, cálculo de resultados.
- **Aggregates**: `Assessment`, `Response`, `Result`
- **API síncrona**: `POST /v1/assessments`, `GET /v1/assessments/{id}`, `POST /v1/assessments/{id}/responses`, `GET /v1/results/me`
- **Eventos emitidos**: `AssessmentStarted`, `AssessmentCompleted`
- **Storage**: schema `assessment` en Aurora (`assessments`, `responses`, `results`)

#### Career Context (TypeScript)

- **Responsabilidad**: catálogo de carreras (CRUD admin, lectura pública).
- **Aggregates**: `Career`, `CareerSkill`, `CareerCategory`
- **API síncrona**: `GET /v1/careers`, `GET /v1/careers/{id}`, `GET /v1/careers/search?q=`
- **Eventos emitidos**: `CareerCreated`, `CareerUpdated`
- **Storage**: schema `career` en Aurora (`careers`, `career_skills`)
- **Nota**: en el MVP es **read-only público**, escritura solo admin (seed data).

#### Matching Context (Python)

- **Responsabilidad**: cálculo de afinidad perfil ↔ carrera, generación de recomendaciones.
- **Aggregates**: `Match`, `Recommendation`
- **API síncrona**: `GET /v1/match/recommendations`, `GET /v1/match/{careerId}/affinity`
- **Eventos consumidos**: `AssessmentCompleted` (trigger recálculo), `ProfileUpdated` (invalidación cache)
- **Eventos emitidos**: `RecommendationGenerated`
- **Storage**: schema `matching` en Aurora + Redis (cache opcional MVP)

#### AI Advisor Context (Python)

- **Responsabilidad**: chat conversacional con Bedrock, RAG sobre catálogo de carreras.
- **Aggregates**: `Conversation`, `Message`, `KnowledgeDocument`
- **API síncrona**: `POST /v1/chat/conversations`, `POST /v1/chat/conversations/{id}/messages`, `GET /v1/chat/conversations/{id}`
- **Eventos consumidos**: `CareerCreated/Updated` (trigger reindex RAG)
- **Eventos emitidos**: `MessageSent`, `KnowledgeDocIngested`
- **Storage**: schema `ai` en Aurora (`conversations`, `messages`) + tabla `embeddings` con pgvector

### 4.3 Contexto cross-cutting: Notifications

Funcionalidad transversal manejada como **event handlers puros**:

- No expone API síncrona (excepto admin para reintentos)
- Se suscribe a eventos de los demás contextos
- Almacena en DynamoDB (barato, sin JOINs complejos)
- Envía emails vía SES

## 5. Patrones de comunicación

### 5.1 Regla de oro

> **Toda comunicación cross-context va por eventos. Nunca por llamada directa.**

Esto significa:

- ❌ Una Lambda de Identity NO puede invocar directamente una Lambda de Matching
- ❌ Una Lambda de Identity NO puede leer/escribir tablas del schema `matching`
- ✅ Una Lambda de Identity escribe en su schema y emite un evento
- ✅ Una Lambda de Matching se suscribe al evento y reacciona

### 5.2 Sync vs Async — Matriz de decisión

| Patrón | Cuándo usarlo | Ejemplo |
|---|---|---|
| **Sync command** (API GW → Lambda) | Usuario espera respuesta inmediata | `POST /auth/login` devuelve token |
| **Async command** (API GW → SQS → Lambda) | Operación larga, reintentos necesarios | Ingestar documento a RAG |
| **Domain event** (Lambda → EventBridge → Lambda) | Propagar cambio entre contextos | `AssessmentCompleted` → Matching |
| **Scheduled event** (EventBridge cron → Lambda) | Tareas periódicas | Reindexar embeddings cada 24h |

### 5.3 Flujo end-to-end de ejemplo

```
Usuario completa assessment
        │
        ▼
[API Gateway] POST /v1/assessments/{id}/responses
        │
        ▼
[Lambda: assessment/complete] (sync)
        │ persiste Result en schema `assessment`
        │ emite evento AssessmentCompleted a EventBridge
        │ responde 200 OK con resumen
        │
        ▼
[EventBridge: spark-match-events]
        │
        ├──[regla: source=assessment, detail-type=AssessmentCompleted]──┐
        │                                                                │
        ▼                                                                ▼
[Lambda: matching/handle-completed]               [Lambda: notifications/welcome]
        │ consume AssessmentCompleted               │ consume AssessmentCompleted
        │ calcula afinidad con todas las carreras   │ encola email "resultados listos"
        │ persiste Recommendation                    │
        │ emite RecommendationGenerated              │
        │                                                       │
        ▼                                                       │
[EventBridge: RecommendationGenerated]                          │
        │                                                       │
        └──[regla]──►[Lambda: notifications/handle-rec] ────────┘
                          │ consume RecommendationGenerated
                          │ envía email con top 3 carreras
```

**Observa**:

1. **El cliente recibe respuesta inmediata** (Lambda síncrona responde en <500ms)
2. **El matching ocurre async** (el usuario puede cerrar la app; el resultado llega por email)
3. **No hay acoplamiento**: Assessment no sabe que Matching existe; Matching no sabe que Notifications existe

## 6. Estrategia de almacenamiento

### 6.1 Aurora PostgreSQL Serverless v2 + pgvector

**Por qué una sola base con schemas lógicos** (en lugar de una BD por contexto):

- ✅ Reduce overhead operacional (un solo endpoint, un solo backup)
- ✅ Reduce coste (un cluster en lugar de N)
- ✅ Permite JOINs cross-schema si son necesarios (ej: vista de "usuario con su último match")
- ✅ Transacciones distribuidas NO son necesarias (cada contexto es dueño de su schema)
- ⚠️ Riesgo: un contexto podría leer/escribir otro schema → **mitigado por CODEOWNERS y revisión**

### 6.2 Esquemas (uno por contexto)

```sql
CREATE SCHEMA identity;     -- users, sessions, profiles
CREATE SCHEMA assessment;   -- assessments, responses, results
CREATE SCHEMA career;       -- careers, career_skills
CREATE SCHEMA matching;     -- matches, recommendations
CREATE SCHEMA ai;           -- conversations, messages, embeddings
```

### 6.3 pgvector para embeddings

La extensión `pgvector` permite almacenar y buscar embeddings directamente en Postgres:

```sql
CREATE TABLE ai.embeddings (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(1536),  -- dimensión de Titan Embeddings
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON ai.embeddings USING ivfflat (embedding vector_cosine_ops);
```

**Alternativas evaluadas**:

- OpenSearch Vector Engine: más potente pero ~$100/mes mínimo
- Pinecone: vendor externo, datos fuera de AWS
- FAISS en Lambda: cold start prohibitivo, no persistente

**Veredicto**: pgvector es la opción correcta para TFP (suficiente, simple, mismo motor que el resto).

### 6.4 DynamoDB para casos específicos

Solo cuando Aurora es overkill:

- **Notifications**: alta escritura, baja latencia de lectura, sin JOINs
- **Session store** (alternativa a JWT stateless en MVP): rápido y barato

## 7. Seguridad

### 7.1 Autenticación

- **MVP**: JWT firmado con clave en Secrets Manager (rotación anual)
- **Futuro**: Amazon Cognito User Pool (delegación completa)

### 7.2 Autorización

- **Nivel API**: API Gateway valida JWT en cada request
- **Nivel contexto**: cada Lambda valida que el `userId` del token coincida con el recurso solicitado
- **Nivel datos**: row-level security en Aurora si multi-tenant

### 7.3 Secrets

- DB credentials, JWT secret, Bedrock API keys → AWS Secrets Manager
- Acceso vía SDK con caché en memoria (TTL 5min)

## 8. Observabilidad

### 8.1 Logging estructurado

- AWS Lambda Powertools (`Logger`):
  - JSON estructurado
  - Inyección automática de `correlationId`, `userId`, `requestId`
  - Niveles: DEBUG, INFO, WARN, ERROR

### 8.2 Tracing distribuido

- AWS X-Ray activo en todas las Lambdas
- Trace propagation entre contextos vía header `X-Amzn-Trace-Id`
- Mapa de servicios en X-Ray console

### 8.3 Métricas y alarmas

CloudWatch dashboards por contexto:

- Lambda: invocaciones, errores, duración, throttles
- Aurora: CPU, conexiones, latencia queries
- EventBridge: eventos publicados, fallidos (DLQ depth)

Alarmas críticas:

- DLQ depth > 0 → alerta inmediata
- Lambda error rate > 1% → alerta
- DB CPU > 70% sostenido → alerta

## 9. CI/CD

### 9.1 Pipelines reutilizables

Todos los workflows de `03-backend` son **callers** de los workflows reutilizables en `01-devops`:

| Workflow en `03-backend` | Workflow reutilizable en `01-devops` |
|---|---|
| `ci.yml` | `lint-checks.yml` (actionlint + gitleaks + yamllint) |
| `deploy.yml` | (pendiente: `sam-deploy.yml`) |
| `test-unit.yml` | (pendiente: `node-python-tests.yml`) |

### 9.2 Orden de despliegue

```
1. terraform apply (02-infrastructure)
   └─ Crea VPC, RDS, IAM, SSM parameters, EventBridge bus
2. sam deploy (03-backend)
   └─ Lee SSM parameters, crea Lambdas + API Gateway + reglas
3. Si falla → rollback manual (SAM no soporta rollback automático nativo)
```

## 10. Roadmap de implementación

| Fase | Alcance | Estado |
|---|---|---|
| **0** | Documentación de arquitectura | ✅ En curso |
| 1 | Scaffold mínimo (template, configs, CI) | ⏳ Pendiente |
| 2 | Shared Kernel (domain base, EventBridge client, JSON Schemas) | ⏳ Pendiente |
| 3 | Identity Context end-to-end | ⏳ Pendiente |
| 4 | AI Advisor Context end-to-end (Bedrock) | ⏳ Pendiente |
| 5 | Career Context (read-only) + Assessment Context | ⏳ Pendiente |
| 6 | Matching Context + event handlers async | ⏳ Pendiente |
| 7 | Observabilidad completa (X-Ray, dashboards) | ⏳ Pendiente |

## 11. Glosario

| Término | Significado |
|---|---|
| **Aggregate** | Cluster de entidades con una raíz, tratado como unidad de consistencia |
| **Bounded Context** | Frontera explícita donde un modelo de dominio es válido |
| **Domain Event** | Hecho del pasado relevante para el negocio (en pasado, inmutable) |
| **Choreography** | Orquestación sin coordinador central; cada servicio reacciona a eventos |
| **Shared Kernel** | Código compartido entre contextos (mínimo, cuidadosamente versionado) |
| **Cold Start** | Latencia de la primera invocación de una Lambda (init del runtime) |
| **pgvector** | Extensión de Postgres para almacenar y buscar vectores (embeddings) |