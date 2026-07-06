# Estructura del Monorepo

> Convenciones para el repositorio `spark-match-03-backend`.
> Cambios a la estructura requieren PR con aprobación de `@spark-match/backend-devs` o `@spark-match/devops`.

## 1. Vista de alto nivel

```
spark-match-03-backend/
├── README.md                       # Quickstart + enlaces a ARCHITECTURE.md
├── ARCHITECTURE.md                 # Diseño general (este repo)
├── DECISIONS.md                    # ADRs
├── EVENT_CATALOG.md                # Catálogo de eventos de dominio
├── FOLDER_STRUCTURE.md             # Este documento
│
├── template.yaml                   # SAM template principal (orquestador)
├── samconfig.toml                  # Configuración SAM por entorno
├── package.json                    # npm workspaces (raíz)
├── package-lock.json
├── pyproject.toml                  # Deps Python (uv/pip)
├── uv.lock
├── tsconfig.base.json              # TS config compartido
├── .eslintrc.cjs                   # ESLint (TS)
├── .prettierrc                     # Prettier
├── ruff.toml                       # Ruff (Python)
│
├── shared/                         # Shared Kernel (mínimo)
│   ├── domain/                     # AggregateRoot, DomainEvent, ValueObject base
│   ├── infrastructure/             # EventBridgeClient, Logger, SsmReader
│   └── contracts/                  # JSON Schemas de eventos v1
│
├── contexts/                       # Bounded Contexts (uno por carpeta)
│   ├── identity/                   # TypeScript
│   ├── assessment/                 # TypeScript
│   ├── career/                     # TypeScript
│   ├── matching/                   # Python
│   └── ai-advisor/                 # Python
│
├── layers/                         # Lambda Layers
│   ├── python-runtime/             # boto3, langchain, pgvector
│   └── node-runtime/               # @aws-sdk/*, zod, jsonwebtoken
│
├── events/                         # Event handlers cross-cutting (async)
│   ├── notifications/              # Python o TS según consumidor
│   └── analytics/                  # Python (ETL a S3)
│
├── tests/
│   ├── unit/                       # Vitest (TS) + pytest (Py)
│   ├── integration/                # LocalStack + testcontainers
│   └── contract/                   # Validación JSON Schema end-to-end
│
├── scripts/
│   ├── seed-db.py                  # Seed inicial de carreras (RIASEC profile)
│   ├── publish-schemas.ts          # Publicar JSON Schemas a EventBridge Registry
│   └── local-api.sh                # Wrapper de `sam local start-api`
│
└── .github/
    └── workflows/
        ├── ci.yml                  # Lint + tests (caller de 01-devops)
        └── deploy.yml              # sam deploy (caller de 01-devops)
```

## 2. Reglas del Shared Kernel

El `shared/` contiene código que **todos los contextos** necesitan. Las reglas son estrictas:

### 2.1 Qué SÍ va en shared

- ✅ **Domain primitives**: `AggregateRoot`, `ValueObject`, `DomainEvent` (clases base)
- ✅ **Infrastructure clients**: wrappers de EventBridge, SSM Parameter Store, Logger
- ✅ **Contracts**: JSON Schemas de eventos
- ✅ **Utilidades puras**: validadores de UUID, helpers de fecha, formateadores

### 2.2 Qué NO va en shared

- ❌ Lógica de negocio (eso va en cada contexto)
- ❌ Modelos específicos (User, Assessment, etc.)
- ❌ Repositorios o acceso a datos
- ❌ Handlers de Lambda
- ❌ Dependencias pesadas (eso va en layers)

### 2.3 Versionado del shared kernel

- Cambios incompatibles requieren PR con tag `breaking-change`
- Cada contexto declara en su `package.json` o `pyproject.toml` la versión que necesita
- CI verifica que no se rompe compatibilidad accidentalmente

## 3. Estructura interna de un Bounded Context

Cada contexto sigue la misma forma (con variaciones de lenguaje):

```
contexts/<name>/
├── README.md                       # Descripción del contexto
│
├── domain/                         # MODELO DE DOMINIO (sin dependencias de infra)
│   ├── aggregates/                 # Aggregate roots
│   ├── entities/                   # Entities dentro de aggregates
│   ├── value-objects/              # Value Objects inmutables
│   └── events/                     # Domain Events
│
├── application/                    # CASOS DE USO (orquestación)
│   ├── commands/                   # Command handlers
│   ├── queries/                    # Query handlers
│   ├── services/                   # Domain Services
│   └── ports/                      # Interfaces (Repository, EventBus, etc.)
│
├── infrastructure/                 # ADAPTADORES (implementaciones de los ports)
│   ├── repositories/               # Aurora impl de los repos
│   ├── event-publishers/          # EventBridge impl del EventBus port
│   └── external-clients/          # SDK wrappers (Bedrock, SES, etc.)
│
└── interfaces/                     # ENTRY POINTS (Lambdas, API handlers)
    ├── lambdas/                    # Una carpeta por handler
    │   └── <action>/
    │       ├── handler.ts          # entry point
    │       └── handler.test.ts
    └── api/                        # Schemas de request/response (Zod)
```

### 3.1 Capas y dependencias

Las dependencias entre capas son **unidireccionales**:

```
interfaces  →  application  →  domain
       ↓             ↓
   infrastructure  →  domain
```

**Reglas**:

- `domain` no importa de nada (cero dependencias de AWS SDK)
- `application` solo importa de `domain` y `application/ports`
- `infrastructure` implementa los `ports` de `application`
- `interfaces` orquesta: usa `application` y `infrastructure` (nunca `domain` directo para lógica)

### 3.2 Lenguaje por contexto

| Contexto | Lenguaje | Carpeta `interfaces/lambdas/<action>/` |
|---|---|---|
| identity | TypeScript | `handler.ts`, `handler.test.ts` |
| assessment | TypeScript | `handler.ts`, `handler.test.ts` |
| career | TypeScript | `handler.ts`, `handler.test.ts` |
| matching | Python | `handler.py`, `test_handler.py` |
| ai-advisor | Python | `handler.py`, `test_handler.py` |

## 4. Naming conventions

### 4.1 Archivos

| Tipo | Convención | Ejemplo |
|---|---|---|
| TypeScript module | `kebab-case.ts` | `user-repository.ts` |
| Python module | `snake_case.py` | `user_repository.py` |
| Test (TS) | `<module>.test.ts` | `user-repository.test.ts` |
| Test (Py) | `test_<module>.py` | `test_user_repository.py` |
| JSON Schema | `<event-name>.v<version>.json` | `user-registered.v1.json` |

### 4.2 Identificadores

| Tipo | Convención | Ejemplo |
|---|---|---|
| Classes (TS) | `PascalCase` | `UserAggregate` |
| Classes (Py) | `PascalCase` | `UserAggregate` |
| Functions (TS) | `camelCase` | `registerUser` |
| Functions (Py) | `snake_case` | `register_user` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_LOGIN_ATTEMPTS` |
| Env vars | `UPPER_SNAKE_CASE` | `JWT_SECRET_ARN` |
| TypeScript types | `PascalCase` | `UserRegisteredEvent` |
| Python types | `PascalCase` | `UserRegisteredEvent` |
| DB tables | `snake_case` | `user_profiles` |
| DB columns | `snake_case` | `created_at` |

### 4.3 Branches y PRs

| Tipo | Prefijo | Ejemplo |
|---|---|---|
| Nueva feature | `feat/` | `feat/identity-register` |
| Bug fix | `fix/` | `fix/identity-login-validation` |
| Refactor | `refactor/` | `refactor/shared-kernel` |
| Documentación | `docs/` | `docs/architecture-phase-0` |
| Chore (CI, deps) | `chore/` | `chore/bump-lambda-layer` |

## 5. Cómo añadir un nuevo Lambda

1. **Crear la carpeta del handler** dentro del contexto:
   ```
   contexts/identity/interfaces/lambdas/register-user/
   ├── handler.ts
   └── handler.test.ts
   ```

2. **Implementar el caso de uso** en `application/commands/`:
   ```
   contexts/identity/application/commands/register-user.ts
   ```

3. **Definir el evento de salida** (si aplica) en `domain/events/` + `shared/contracts/identity/`:
   ```
   contexts/identity/domain/events/user-registered.ts
   shared/contracts/identity/user-registered.v1.json
   ```

4. **Registrar en `template.yaml`**:
   ```yaml
   Resources:
     RegisterUserFunction:
       Type: AWS::Serverless::Function
       Properties:
         Handler: contexts/identity/interfaces/lambdas/register-user/handler.handler
         Runtime: nodejs20.x
         MemorySize: 256
         Timeout: 10
         Events:
           RegisterApi:
             Type: HttpApi
             Properties:
               Path: /v1/auth/register
               Method: POST
   ```

5. **Agregar tests**:
   - Unit: `handler.test.ts`
   - Integration: `tests/integration/identity/register.test.ts`

6. **Abrir PR** con CODEOWNERS del equipo backend-devs

## 6. Cómo añadir un nuevo evento de dominio

1. **Definir el JSON Schema** en `shared/contracts/<context>/`:
   ```
   shared/contracts/identity/user-registered.v1.json
   ```

2. **Implementar la clase del evento** en `contexts/<context>/domain/events/`:
   ```
   contexts/identity/domain/events/user-registered.ts
   ```

3. **Definir el puerto** en `application/ports/`:
   ```
   contexts/identity/application/ports/event-bus.ts
   ```

4. **Implementar el adaptador** (si es nuevo tipo de evento) en `infrastructure/event-publishers/`:
   ```
   contexts/identity/infrastructure/event-publishers/eventbridge-bus.ts
   ```

5. **Publicar el schema** ejecutando:
   ```bash
   npm run scripts/publish-schemas.ts
   ```

6. **Documentar en `EVENT_CATALOG.md`** (añadir a la tabla de eventos v1 + matriz productor/consumidor)

## 7. Cómo añadir un nuevo Bounded Context

1. **Crear la carpeta**:
   ```
   contexts/<new-context>/
   ```

2. **Definir README** del contexto con:
   - Responsabilidad
   - Aggregates principales
   - Lenguaje (TS o Py)
   - Storage schema

3. **Definir aggregates y eventos** (ver sección 5/6)

4. **Añadir schema en Aurora** (módulo `database` en `02-infrastructure`)

5. **Registrar en `template.yaml`** como nested stack:
   ```yaml
   Resources:
     NewContextStack:
       Type: AWS::CloudFormation::Stack
       Properties:
         TemplateURL: contexts/<new-context>/template.yaml
   ```

6. **Actualizar `ARCHITECTURE.md`** y `EVENT_CATALOG.md`

7. **PR con CODEOWNERS** del equipo correspondiente

## 8. Lambda Layers

Las layers se construyen localmente y se suben como assets de SAM:

```
layers/python-runtime/
├── python/
│   ├── boto3/             # incluido en runtime, pero versionado explícito
│   ├── langchain/
│   ├── pgvector/
│   └── ...
└── buildspec.yml          # script de build con uv

layers/node-runtime/
├── nodejs/
│   ├── node_modules/
│   │   ├── @aws-sdk/
│   │   ├── zod/
│   │   └── ...
└── package.json
```

**Reglas**:

- Layer nunca incluye el runtime (eso lo gestiona AWS Lambda)
- Layer máximo 50MB (compressed)
- Build reproducible: pin de versiones en `pyproject.toml` / `package.json`

## 9. Configuración por entorno

`samconfig.toml` define los parámetros por entorno:

```toml
[default.deploy.parameters]
region = "us-east-1"
capabilities = "CAPABILITY_IAM CAPABILITY_AUTO_EXPAND"

[prod.deploy.parameters]
stack_name = "spark-match-backend-prod"
s3_bucket = "spark-match-tfstate-prod"
s3_prefix = "sam/spark-match-backend-prod"
parameter_overrides = [
  "Environment=prod",
  "DbEndpoint={{resolve:ssm:/spark-match/prod/db/endpoint}}",
  "JwtSecretArn={{resolve:ssm:/spark-match/prod/jwt/secret-arn}}"
]
confirm_changeset = true
```

Deploy:

```bash
sam build
sam deploy --config-env prod
```

## 10. Variables de entorno en Lambdas

Toda Lambda recibe estas variables automáticamente:

| Variable | Valor | Fuente |
|---|---|---|
| `ENVIRONMENT` | `prod` \| `dev` | SAM `Environment` block |
| `LOG_LEVEL` | `INFO` \| `DEBUG` | SAM |
| `AWS_REGION` | (auto) | Lambda runtime |
| `EVENT_BUS_NAME` | `spark-match-events` | SAM parameter |
| `DB_SECRET_ARN` | (SSM path) | SAM parameter |
| `JWT_SECRET_ARN` | (SSM path) | SAM parameter |

**Regla**: nunca hardcodear valores. Si necesitas un config nuevo, añadirlo a SAM parameter + `samconfig.toml`.

## 11. Anti-patrones prohibidos

❌ **Cross-context imports**: una Lambda de Identity NO importa código de Matching
❌ **Acceso directo a DB de otro contexto**: Lambda de Matching NO hace `SELECT * FROM identity.users`
❌ **Llamadas síncronas entre Lambdas**: usar EventBridge siempre
❌ **Hardcoded secrets**: usar SSM Parameter Store o Secrets Manager
❌ **Lambda > 15min**: descomponer en pasos async
❌ **Lambda > 250MB unpacked**: usar Layer o split
❌ **Tests que dependen de AWS real**: usar LocalStack o mocks
❌ **Schema changes sin versionado**: bump `version` field en JSON Schema