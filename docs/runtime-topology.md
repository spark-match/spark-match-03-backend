# Runtime Topology — Spark Match Backend

> Operational view of what is **actually deployed** in `spark-match-03-backend`
> (TypeScript + AWS SAM). For high-level architecture, bounded-context rationale
> and ADRs see [architecture.md](./architecture.md). For event payload schemas
> see [event-catalog.md](./event-catalog.md).

Last reviewed: 2026-07-28. Status: **Identity context live**, other contexts not yet scaffolded.

---

## 0. Container diagram (C4 level 2)

Diagrama C4-nivel-contenedor para el **Identity context** (nico live). Muestra
todos los servicios externos y la wiring de red/VPC/secrets.

```
              ┌──────────────────────────────────────────┐
              │  HTTP API Gateway v2 (HttpApi)          │
              │  - CORS: *  (dev)                       │
              │  - Stage: dev|staging|prod              │
              └─────────────┬────────────────────────────┘
                            │
                            │  /v1/auth/*, /v1/users/*, /v1/users/me/*
                            │
              ┌─────────────▼────────────────────────────┐
              │  Identity Lambdas (11 fns)              │
              │  - register, login, get-me, update-*     │
              │  - list-users, activate, deactivate     │
              │  - authorizer (Lambda Authorizer)       │
              │  - migrate (direct invoke, IAM-only)    │
              └────┬──────┬──────┬───────┬──────┬───────┘
                   │      │      │       │      │
       ┌───────────┘      │      │       │      └────────────┐
       │                  │      │       │                   │
       │ read/write       │      │       │                   │
       │                  │      │       │                   │
       ▼                  ▼      │       ▼                   ▼
┌────────────────┐ ┌────────────┴───┐ ┌──────────┐ ┌────────────────┐
│  RDS Aurora    │ │ EventBridge    │ │ SSM Param│ │ Secrets Mgr    │
│  PostgreSQL    │ │ Custom Bus     │ │ Store    │ │                │
│  Serverless v2 │ │ spark-match-   │ │          │ │                │
│                │ │ events-${env}  │ │ /spark-  │ │ JWT secret     │
│  - identity.   │ │                │ │ match/*  │ │ DB credentials │
│    users       │ └────────────────┘ │          │ │                │
│  - identity.   │                    └──────────┘ └────────────────┘
│    audit_log   │                          ▲              ▲
│  - public.     │                          │              │
│    spark_match_│       ┌──────────────────┘              │
│    migrations  │       │  resolve:ssm: placeholders      │
└────────────────┘       │  evaluated at deploy time        │
       ▲                 └───────────────────────────────────┘
       │
       │  VPC private subnet
       │  (dev: not attached; staging/prod: yes)
       │
   ┌───┴─────────────────────────────┐
   │  VPC + subnets + security group │
   │  (only when VpcSubnetIds param  │
   │   is non-empty)                 │
   └─────────────────────────────────┘

   ┌──────────────────────────────────────────────────────┐
   │  Lambda Layers (2)                                   │
   │  - spark-match-node-shared-${env}  (compiled shared)│
   │  - spark-match-node-runtime-${env} (zod, middy,     │
   │    powertools, kysely, pg, jose, ...)                │
   │                                                      │
   │  RDS CA bundle: /var/task/certificates/rds.pem       │
   │  (NODE_EXTRA_CA_CERTS) — must be in runtime layer    │
   └──────────────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────┐
   │  CloudWatch Logs                                     │
   │  - /aws/spark-match/${env}/application (root)        │
   │  - /aws/lambda/spark-match-identity-* (per-fn, 14d)  │
   │  - X-Ray traces (Tracing: Active)                    │
   └──────────────────────────────────────────────────────┘
```

**Notas**:
- HTTP API Gateway NO tiene capa Lambda Authorizer cacheada
  (`AuthorizerResultTtlInSeconds: 0`); cada peticin re-verifica JWT.
- Solo `PATCH /v1/users/me` invoca `IdentityAuthorizer`. Las otras 7
  rutas protegidas dependen de middleware `requireAuth` (defensa en
  profundidad, ver [auth-rbac.md § 3.2](./auth-rbac.md)).
- VPC: dev runs son **non-VPC** (subnet IDs vacos); staging/prod usan
  VPC con subnets privadas. El cdigo condicional vive en
  [`contexts/identity/template.yaml:48`](../contexts/identity/template.yaml).
- RDS CA bundle es necesario para conexiones TLS (Node 24 no carga
  Amazon CAs automticamente). Vive en la capa runtime — **gap
  conocido**: `layers/node-runtime/build.sh` debera copiar el bundle
  al path esperado (ver ADR backlog).

---

## 1. HTTP API Gateway v2 routes

The root stack ([template.yaml](../template.yaml)) creates **one** HTTP API
Gateway v2 (`HttpApi`), shared by every bounded-context nested stack. Routes
are scoped per context but all attach to the same API ID.

### 1.1 Route inventory (Identity context)

| Method | Path | Handler Lambda | Authorizer | Admin-only | Event emitted |
|---|---|---|---|---|---|
| `POST` | `/v1/auth/register` | `IdentityRegisterFunction` | none | no | `UserRegistered` |
| `POST` | `/v1/auth/login` | `IdentityLoginFunction` | none | no | `UserLoggedIn` |
| `GET`  | `/v1/users/me` | `IdentityGetMeFunction` | none¹ | no | — |
| `PATCH`| `/v1/users/me` | `IdentityUpdateProfileFunction` | `IdentityAuthorizer` | no | `UserUpdated` |
| `PUT`  | `/v1/users/me/password` | `IdentityChangePasswordFunction` | none¹ | no | `UserPasswordChanged` |
| `GET`  | `/v1/users` | `IdentityListUsersFunction` | none¹ | **yes** | — |
| `POST` | `/v1/users/{userId}/activate` | `IdentityActivateUserFunction` | none¹ | **yes** | `UserActivated` |
| `POST` | `/v1/users/{userId}/deactivate` | `IdentityDeactivateUserFunction` | none¹ | **yes** | `UserDeactivated` |
| `PATCH`| `/v1/users/{userId}` | `IdentityUpdateUserFunction` | none¹ | **yes** | `UserUpdated` |

¹ Authorizer wired to `none` at the route level — the handler enforces
authentication + role checks via the `buildHandler().requireAuth(requireRole(...))`
middleware. See [§ 3 Authorizer wiring](#3-authorizer-wiring) for the rationale
and the [tracked inconsistency](../AGENTS.md) (only `update-profile` is wired
through `IdentityAuthorizer` at the API layer; the rest rely on middleware).

### 1.2 Non-HTTP Lambda functions

| Function | Invocation | Purpose |
|---|---|---|
| `IdentityAuthorizerFunction` | API Gateway (Lambda Authorizer REQUEST) | Verifies JWT, attaches `userId`/`email`/`role` to `event.requestContext.authorizer.lambda` |
| `IdentityMigrateFunction` | Direct `aws lambda invoke` (IAM-auth) | Runs `node-pg-migrate up/down` against Aurora |

The migrate function is **not** exposed via HTTP. Prior implementations used
a token-based auth on the HTTP surface; the current design relies on
`lambda:InvokeFunction` IAM permissions (no static secret to rotate, no
attack surface).

---

## 2. Lambda inventory

### 2.1 Global defaults (root stack)

| Setting | Value | Notes |
|---|---|---|
| Runtime | `nodejs24.x` | Lambda Node 24 LTS |
| Memory | `512 MB` | |
| Timeout | `15 s` | |
| Tracing | `Active` (X-Ray) | |
| Architecture | `x86_64` | |
| Layers | `NodeSharedLayer` + `NodeRuntimeLayer` | See § 4 |

### 2.2 Per-function overrides

| Function | CodeUri | Handler | Memory | Timeout | VPC | Extra policies |
|---|---|---|---|---|---|---|
| `IdentityRegisterFunction` | `./src/handlers` | `register.handler` | 512 | 10 | conditional² | Secrets, EventBridge, SSM |
| `IdentityLoginFunction` | `./src/handlers` | `login.handler` | 512 | 10 | conditional² | Secrets |
| `IdentityGetMeFunction` | `./src/handlers` | `get-me.handler` | 512 | 10 | conditional² | Secrets |
| `IdentityUpdateProfileFunction` | `./src/handlers` | `update-profile.handler` | 512 | 10 | conditional² | Secrets |
| `IdentityChangePasswordFunction` | `./src/handlers` | `change-password.handler` | 512 | 10 | conditional² | Secrets |
| `IdentityListUsersFunction` | `./src/handlers` | `list-users.handler` | 512 | 10 | conditional² | Secrets |
| `IdentityActivateUserFunction` | `./src/handlers` | `activate-user.handler` | 512 | 10 | conditional² | Secrets, EventBridge |
| `IdentityDeactivateUserFunction` | `./src/handlers` | `deactivate-user.handler` | 512 | 10 | conditional² | Secrets, EventBridge |
| `IdentityUpdateUserFunction` | `./src/handlers` | `update-user.handler` | 512 | 10 | conditional² | Secrets, EventBridge |
| `IdentityAuthorizerFunction` | `./src/handlers` | `authorizer.handler` | **256** | 10 | conditional² | Secrets (JWT), SSM |
| `IdentityMigrateFunction` | `./src/handlers` | `migrate.handler` | **1024** | **60** | conditional² | Secrets, SSM |

² VPC attached only when `VpcSubnetIds` parameter is non-empty
(`HasVpcConfig` condition). Dev runs are non-VPC; staging/prod use VPC.

### 2.3 Environment variables (resolved from SSM at deploy time)

| Variable | Source | Notes |
|---|---|---|
| `POWERTOOLS_SERVICE_NAME` | `!Sub '${AWS::StackName}'` (root) or `'identity-${Environment}'` (nested) | AWS Lambda Powertools |
| `POWERTOOLS_LOG_LEVEL` | `INFO` | |
| `LOG_LEVEL` | `INFO` | |
| `ENVIRONMENT` | `!Ref Environment` | `dev`/`staging`/`prod` |
| `EVENT_BUS_ARN` | `ssm:/spark-match/eventbridge/bus-arn` | EventBridge custom bus |
| `DB_SECRET_ARN` | `ssm:/spark-match/db/secret-arn` | Aurora credentials (Secrets Manager) |
| `JWT_SECRET_ARN` | `ssm:/spark-match/secret/jwt-arn` | HS256 signing key (Secrets Manager) |
| `IDEMPOTENCY_TABLE_NAME` | `ssm:/spark-match/dynamodb/idempotency-table` | Reserved for idempotent handlers (none today) |
| `NODE_EXTRA_CA_CERTS` | `/var/task/certificates/rds.pem` | RDS CA bundle (Node 24 does not auto-load Amazon CAs) |
| `MIGRATE_DATABASE_URL` (migrate only) | `ssm:/spark-match/db/connection-url` | Resolved by Terraform from the same secret as `DB_SECRET_ARN` |

### 2.4 IAM policies (template-level)

| Policy | Used by |
|---|---|
| `SecretsManagerReadWritePolicy` (DB secret) | All Identity handlers + Authorizer + Migrate |
| `SecretsManagerReadWritePolicy` (JWT secret) | Authorizer only |
| `EventBridgePutEventsPolicy` | Register, ActivateUser, DeactivateUser, UpdateUser |
| `SSMParameterReadPolicy` (`spark-match-${Environment}-*`) | Register, Authorizer, Migrate |

> ⚠️ **Known scope issue (Sprint 5 backlog)**: `SecretsManagerReadWritePolicy`
> grants `Resource: '*'` for Secrets Manager (5 occurrences). Must be scoped
> to the specific secret ARNs before production. See tracked TODO.

### 2.5 Source layout (deployed files)

All lambdas share `CodeUri: ./src/handlers` from
[`contexts/identity/template.yaml`](../contexts/identity/template.yaml).
SAM bundles each handler separately (`esbuild` per-function):

```
contexts/identity/src/handlers/
  register.ts            → IdentityRegisterFunction
  login.ts               → IdentityLoginFunction
  get-me.ts              → IdentityGetMeFunction
  update-profile.ts      → IdentityUpdateProfileFunction
  change-password.ts     → IdentityChangePasswordFunction
  list-users.ts          → IdentityListUsersFunction
  activate-user.ts       → IdentityActivateUserFunction
  deactivate-user.ts     → IdentityDeactivateUserFunction
  update-user.ts         → IdentityUpdateUserFunction
  authorizer.ts          → IdentityAuthorizerFunction (non-HTTP)
  migrate.ts             → IdentityMigrateFunction (non-HTTP)
  index.ts               ← NOT used by SAM; convenience re-exports for tests
```

Each `.ts` file exports `handler` (the SAM `<filename>.<export>` convention).
The `index.ts` re-exports them under alternative names (`export { handler as register }`)
for composition/test convenience only.

---

## 3. Authorizer wiring

The `IdentityAuthorizerFunction` is a **Lambda Authorizer (REQUEST type)**
for HTTP API v2. API Gateway invokes it **before** any route that opts in
via `Auth: { Authorizer: !Ref IdentityAuthorizer }`.

**Simple Response format** (no IAM `lambda:InvokeFunction` permission
required for downstream Lambdas — API Gateway forwards the returned context
in the event payload).

### 3.1 Current wiring (as of Sprint 1)

Only **one** route is wired to the Authorizer at the API layer:

```yaml
UpdateProfileApi:
  Properties:
    ApiId: !Ref HttpApiId
    Path: /v1/users/me
    Method: PATCH
    Auth:
      Authorizer: !Ref IdentityAuthorizer   # ← only route with API-layer auth
```

The remaining 8 protected routes declare `Authorizer: NONE` and rely on the
**handler-layer** `buildHandler().requireAuth(requireRole('admin'))`
middleware to reject unauthenticated/wrong-role requests. This works
defensively but means the Authorizer Lambda is bypassed for those paths.

**Why the inconsistency?** The Authorizer was wired last in the codebase;
the 8 handlers were already protected by middleware. Wiring all routes
through `IdentityAuthorizer` would be the cleaner model but requires
re-deploying every route. **Tracked for Sprint 3.**

### 3.2 `AuthorizerResultTtlInSeconds: 0`

The Authorizer returns a Simple Response with TTL=0, meaning **every
request** triggers a fresh JWT verification. There is no API Gateway-side
caching. Tradeoff: small per-request latency (~30 ms cold, ~5 ms warm) vs.
zero risk of stale role data after a `role` change.

### 3.3 Context returned to downstream Lambdas

On success the Authorizer attaches the JWT claims to
`event.requestContext.authorizer.lambda`:

```ts
{
  userId: string,   // UUID
  email: string,
  role: 'admin'
}
```

The `requireAuth` middleware reads these and types the handler context.
See [`shared/src/auth/require-auth.ts`](../shared/src/auth/require-auth.ts) for the contract.

---

## 4. Lambda layers

Two layers built from [`layers/`](../layers/):

| Layer | Source | Contents |
|---|---|---|
| `spark-match-node-shared-${Environment}` | `./layers/node-shared/dist` | Compiled `@spark-match/shared` (auth, http, events, infra, logger, templates) |
| `spark-match-node-runtime-${Environment}` | `./layers/node-runtime` | Third-party runtime deps: `zod`, `middy`, `@aws-lambda-powertools/*`, `kysely`, `pg`, `jose`, `@middy/core` |

Both target `nodejs24.x`. Retention policy: `Retain` (layer versions are
not deleted on stack removal to avoid breaking dependent Lambdas).

---

## 5. Database topology — Aurora PostgreSQL Serverless v2

Single Aurora cluster (created by Terraform in `spark-match-02-infrastructure`),
one DB per environment (`dev`/`staging`/`prod`). Credentials in Secrets
Manager; ARN exposed via SSM `/spark-match/db/secret-arn`.

**Schema-per-bounded-context** strategy (see [architecture.md § 6.2](./architecture.md)):

```
spark_match (database)
├── public
│   └── spark_match_migrations   ← node-pg-migrate tracking (created by V001)
└── identity                    ← Identity context schema
    ├── users                   ← V002 (+ role/active from V003)
    └── audit_log               ← V004
```

### 5.1 Schemas / tables inventory

| Schema | Table | Created by | Owner context |
|---|---|---|---|
| `public` | `spark_match_migrations` | V001 | shared (migrator) |
| `identity` | `users` | V002 (base) + V003 (role, active) | Identity |
| `identity` | `audit_log` | V004 | Identity |

**Future contexts** (Assessment, Career, Matching, Notifications) will
each get their own schema (`assessment.*`, `career.*`, `matching.*`,
`notifications.*`) under the same database, applied via additional
node-pg-migrate folders in a `migrations/<context>/` split once they
land.

### 5.2 `identity.users` (V002 + V003)

| Column | Type | Nullable | Default | Source |
|---|---|---|---|---|
| `id` | `UUID` | no | `gen_random_uuid()` | V002 |
| `email` | `VARCHAR(255)` | no | — | V002 (`UNIQUE`, app-layer lowercase) |
| `full_name` | `VARCHAR(255)` | no | — | V002 |
| `password_hash` | `VARCHAR(255)` | no | — | V002 (`scrypt$N$r$p$<salt>$<hash>`) |
| `age` | `SMALLINT` | yes | — | V002 |
| `created_at` | `TIMESTAMPTZ` | no | `current_timestamp` | V002 |
| `updated_at` | `TIMESTAMPTZ` | no | `current_timestamp` | V002 + auto-touch trigger |
| `role` | `TEXT` | no | `'admin'` | V003 (`CHECK role IN ('admin')`) |
| `active` | `BOOLEAN` | no | `TRUE` | V003 |

Indexes:

| Index | Columns | Source |
|---|---|---|
| `users_pkey` | `id` | V002 (implicit) |
| `users_email_key` | `email` | V002 (implicit UNIQUE) |
| `identity_users_active_email_idx` | `(active, email)` | V003 — supports `list-users` filter+sort |

Triggers:

| Trigger | Fires | Effect |
|---|---|---|
| `users_touch_updated_at` | `BEFORE UPDATE` | Sets `NEW.updated_at = current_timestamp` |

### 5.3 `identity.audit_log` (V004)

Append-only audit trail. Inserted from the **same transaction** as the
business change (so a failed audit write rolls back the change).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `BIGSERIAL` | no | sequence | Monotonic primary key |
| `occurred_at` | `TIMESTAMPTZ` | no | `current_timestamp` | |
| `action` | `TEXT` | no | — | Free-form (`user.login`, `user.role_changed`, ...) — no CHECK constraint by design |
| `actor_user_id` | `UUID` | yes | — | `FK → users(id) ON DELETE SET NULL` |
| `subject_user_id` | `UUID` | yes | — | `FK → users(id) ON DELETE SET NULL` |
| `metadata` | `JSONB` | no | `'{}'::jsonb` | Action-specific context (IP, userAgent, old/new role, ...) |

Indexes:

| Index | Columns | Notes |
|---|---|---|
| `audit_log_pkey` | `id` | implicit |
| `identity_audit_log_occurred_at_idx` | `(occurred_at DESC)` | Time-range scans |
| `identity_audit_log_subject_idx` | `(subject_user_id, occurred_at DESC) WHERE subject_user_id IS NOT NULL` | Partial; per-user history |
| `identity_audit_log_action_idx` | `(action, occurred_at DESC)` | Action-type reports |

> **Compliance TODO (Sprint 5+)**: revoke `UPDATE`/`DELETE` on
> `identity.audit_log` for the application's DB role. Currently a
> comment in V004.

### 5.4 Migration history

| Version | Description | Applied via |
|---|---|---|
| `V001__create_identity_schema_and_tracking.sql` | `identity` schema + `public.spark_match_migrations` table | `IdentityMigrateFunction` |
| `V002__create_users_table.sql` | `identity.users` base table + `touch_updated_at` trigger | `IdentityMigrateFunction` |
| `V003__add_role_and_active_to_users.sql` | `role`, `active` columns + `(active, email)` index | `IdentityMigrateFunction` |
| `V004__create_audit_log.sql` | `identity.audit_log` table + 3 indexes | `IdentityMigrateFunction` |

Manual invocation:

```bash
aws lambda invoke \
  --function-name spark-match-identity-migrate-dev \
  --payload '{"direction":"up"}' \
  out.json
```

Dry-run is not yet wired (tracked for **Sprint 2 #1**).

### 5.5 TypeScript ↔ SQL mapping

- DB row type: `Database['identity.users']` in
  [`contexts/identity/src/infra/user-repository.ts`](../contexts/identity/src/infra/user-repository.ts)
- Domain model: [`User`](../contexts/identity/src/domain/user.ts)
- Repository: Kysely queries against the `identity.users` table

When adding a column to `identity.users`, update **all three** in the
same PR: SQL migration, Kysely `Database` type, and domain `User`
interface.

---

## 6. EventBridge topology

Custom bus: `spark-match-events-${Environment}` (ARN via
`ssm:/spark-match/eventbridge/bus-arn`, created by Terraform).

### 6.1 Producers (current)

| Lambda | Event(s) emitted | Schema version |
|---|---|---|
| `IdentityRegisterFunction` | `UserRegistered` | `1.0` |
| `IdentityLoginFunction` | `UserLoggedIn` | `1.0` |
| `IdentityUpdateProfileFunction` | `UserUpdated` (self) | `1.0` |
| `IdentityChangePasswordFunction` | `UserPasswordChanged` | `1.0` |
| `IdentityActivateUserFunction` | `UserActivated` | `1.0` |
| `IdentityDeactivateUserFunction` | `UserDeactivated` | `1.0` |
| `IdentityUpdateUserFunction` | `UserUpdated` (admin) + `UserRoleChanged` (if role changed) | `1.0` |

All event schemas live in
[`contexts/identity/src/domain/events.ts`](../contexts/identity/src/domain/events.ts)
and are validated by Zod before `putEvent` invocation. Full payload
shapes documented in [event-catalog.md](./event-catalog.md).

### 6.2 Consumers (current)

**None.** No downstream context subscribes to identity events yet. The
events are emitted for forward compatibility (assessment context will
listen to `UserRegistered` once it lands). The IAM policy
`EventBridgePutEventsPolicy` is granted; rules/targets will be added by
the consumer context's nested stack.

### 6.3 Source naming

- Producer source: `spark-match.identity`
- Detail types: PascalCase past-tense (`UserRegistered`, `UserDeactivated`, ...)

---

## 7. Cross-cutting concerns

| Concern | Where it lives |
|---|---|
| JWT auth (jose@6.2.4, HS256) | [`shared/src/auth/`](../shared/src/auth/) |
| Password hashing (scrypt N=16384 r=8) | [`shared/src/auth/hash-password.ts`](../shared/src/auth/hash-password.ts) |
| HTTP middleware (error mapper, request ID, body parsing) | [`shared/src/templates/buildHandler.ts`](../shared/src/templates/) |
| DB connection pool (Kysely + pg) | [`contexts/identity/src/infra/db-connection.ts`](../contexts/identity/src/infra/db-connection.ts) |
| Secrets resolution (cached SSM/Secrets reader) | [`shared/src/infra/`](../shared/src/infra/) |
| Structured logging (Powertools) | [`shared/src/logger/`](../shared/src/logger/) |
| X-Ray tracing | Lambda env `Tracing: Active` + Powertools |
| RDS CA bundle | `NODE_EXTRA_CA_CERTS=/var/task/certificates/rds.pem` (shipped via runtime layer) |
| VPC | Optional via `VpcSubnetIds`/`VpcSecurityGroupIds` params (dev: off; staging/prod: on) |

---

## 8. Outputs (root stack)

| Output | Description |
|---|---|
| `HttpApiUrl` | `https://${HttpApi}.execute-api.${AWS::Region}.amazonaws.com/${Environment}` |
| `HttpApiId` | HTTP API Gateway ID |
| `NodeSharedLayerArn` | Shared utilities layer ARN |
| `NodeRuntimeLayerArn` | Runtime deps layer ARN |
| `IdentityStackVpcSubnetIds` | Forwarded subnet IDs (CSV) |
| `IdentityStackVpcSecurityGroupIds` | Forwarded security group IDs (CSV) |

All exports are tagged `spark-match-${Environment}-*` for cross-stack
imports (Terraform uses them).
