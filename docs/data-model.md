# Data Model — Spark Match Backend

> Single source of truth para el modelo de datos del backend. Cubre el
> schema `identity` (live), las tablas compartidas (`public.*`), y la
> convencin **schema-per-bounded-context** que se aplicar a futuros
> contextos.
>
> Por contexto: ER diagram + tablas con columnas, FKs, ndices, triggers.
> Para el inventario runtime (env vars, capas, VPC), ver
> [runtime-topology.md](./runtime-topology.md).

Last reviewed: 2026-07-28.

---

## 1. Convencin: schema-per-bounded-context

Cada **bounded context** (Identity, Assessment, Career, Matching,
Notifications) ocupa su propio schema en la misma base de datos Aurora.
Las tablas compartidas que no pertenecen a ningn contexto (la tabla de
tracking del migrator) viven en `public`.

```
spark_match (database)
  public                  ← tablas compartidas (solo migrator)
    spark_match_migrations
  identity                ← Identity context (LIVE)
    users
    audit_log             ← escrita por user-service (ADR-015)
  (assessment)            ← planned, no migrada
  (career)                ← planned, no migrada
  (matching)              ← planned, no migrada
  (notifications)         ← planned, no migrada
```

**Reglas**:
- Las migraciones viven en `migrations/V0NN__<descripcion>.sql` (un solo
  directorio compartido, ordenado por nombre de archivo).
- `node-pg-migrate` las aplica con `schema: 'public'` y `migrationsTable:
  'spark_match_migrations'`. **Importante**: las migraciones pueden usar
  cualquier schema; el de tracking es solo `public`.
- Los Kysely `Database` types se declaran en
  `contexts/<ctx>/src/infra/<repo>.ts` con schema qualifiers via
  `withSchema()`. Ver § 6.

---

## 2. Diagrama entidad-relacin — `identity` schema (live)

```
                  ┌──────────────────────────────────┐
                  │  identity.users                  │
                  ├──────────────────────────────────┤
                  │ PK  id              UUID         │
                  │ UK  email           VARCHAR(255) │
                  │     full_name       VARCHAR(255) │
                  │     password_hash   VARCHAR(255) │
                  │     age             SMALLINT     │
                  │     role            TEXT (admin) │
                  │     active          BOOLEAN      │
                  │     created_at      TIMESTAMPTZ  │
                  │     updated_at      TIMESTAMPTZ  │ ◄── trigger
                  └──────────────────────────────────┘  touch_updated_at()
                            ▲                ▲
                            │                │
                            │ FK ON DELETE   │ FK ON DELETE
                            │ SET NULL       │ SET NULL
              ┌─────────────┴──┐       ┌────┴─────────────┐
              │ actor_user_id  │       │ subject_user_id  │
              └────────────────┘       └──────────────────┘
                            │                │
                  ┌─────────┴────────────────┴──────────┐
                  │  identity.audit_log                 │
                  ├─────────────────────────────────────┤
                  │ PK  id              BIGSERIAL       │
                  │     occurred_at     TIMESTAMPTZ     │
                  │     action          TEXT            │
                  │ FK  actor_user_id   UUID NULL       │
                  │ FK  subject_user_id UUID NULL       │
                  │     metadata        JSONB           │
                  └─────────────────────────────────────┘

                  ┌──────────────────────────────────┐
                  │  public.spark_match_migrations   │
                  ├──────────────────────────────────┤
                  │ PK  name       TEXT              │
                  │     run_on     TIMESTAMPTZ       │
                  └──────────────────────────────────┘
```

**Cardinalidad**:
- `users 1 ← (0..*) audit_log.actor_user_id` (un usuario puede aparecer
  como actor en muchos audit entries).
- `users 1 ← (0..*) audit_log.subject_user_id` (idem como sujeto).
- **NO** hay `UNIQUE` ni `NOT NULL` sobre los FKs de `audit_log`: ambas
  son NULL con `ON DELETE SET NULL` para preservar el trail histrico
  incluso si el user es borrado (compliance-friendly).

---

## 3. `identity.users` (V002 + V003)

**Migraciones**: [V002__create_users_table.sql](../migrations/V002__create_users_table.sql),
[V003__add_role_and_active_to_users.sql](../migrations/V003__add_role_and_active_to_users.sql).

| Columna | Tipo | Nullable | Default | Origen | Notas |
|---|---|---|---|---|---|
| `id` | `UUID` | no | `gen_random_uuid()` | V002 | PK; `pgcrypto` extension habilitada por V002 |
| `email` | `VARCHAR(255)` | no | — | V002 | `UNIQUE`; lowercase enforced en la app |
| `full_name` | `VARCHAR(255)` | no | — | V002 | |
| `password_hash` | `VARCHAR(255)` | no | — | V002 | Formato `scrypt$N$r$p$salt_b64u$hash_b64u` |
| `age` | `SMALLINT` | s | `NULL` | V002 | Rango app-enforced: 13..120 |
| `created_at` | `TIMESTAMPTZ` | no | `current_timestamp` | V002 | |
| `updated_at` | `TIMESTAMPTZ` | no | `current_timestamp` | V002 + trigger | Auto-touched por `users_touch_updated_at` |
| `role` | `TEXT` | no | `'admin'` | V003 | `CHECK (role IN ('admin'))` |
| `active` | `BOOLEAN` | no | `TRUE` | V003 | `FALSE` deshabilita login sin borrar la fila |

### 3.1 ndices

| Nombre | Columnas | Tipo | Propsito |
|---|---|---|---|
| `users_pkey` | `id` | btree (PK implcito) | |
| `users_email_key` | `email` | btree (UNIQUE implcito) | `findByEmail`, `existsByEmail` |
| `identity_users_active_email_idx` | `(active, email)` | btree (V003) | Soporta `listUsers` con filtro `active` + sort por email |

### 3.2 Triggers

| Trigger | Evento | Funcin | Efecto |
|---|---|---|---|
| `users_touch_updated_at` | `BEFORE UPDATE` | `identity.touch_updated_at()` | `NEW.updated_at = current_timestamp` |

La funcin trigger vive en el schema `identity` y se aplica solo a la tabla
`users`. Si se ampla a otras tablas del schema, replicar la funcin.

### 3.3 Extensions

| Extension | Habilitada por | Uso |
|---|---|---|
| `pgcrypto` | V002 | `gen_random_uuid()` para `id` |

`pgcrypto` viene pre-instalado en Aurora PostgreSQL pero la migracin lo
declara explcitamente con `CREATE EXTENSION IF NOT EXISTS` para que el
schema sea portable a un Postgres fresco.

---

## 4. `identity.audit_log` (V004)

**Migracin**: [V004__create_audit_log.sql](../migrations/V004__create_audit_log.sql).

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | `BIGSERIAL` | no | secuencia | PK monotnica |
| `occurred_at` | `TIMESTAMPTZ` | no | `current_timestamp` | |
| `action` | `TEXT` | no | — | Identificador libre (`user.login`, `user.role_changed`, ...). **No** tiene CHECK constraint: nuevos actions se aaden en cdigo ms rpido que en migraciones. |
| `actor_user_id` | `UUID` | s | — | FK → `users(id) ON DELETE SET NULL` |
| `subject_user_id` | `UUID` | s | — | FK → `users(id) ON DELETE SET NULL` |
| `metadata` | `JSONB` | no | `'{}'::jsonb` | Contexto adicional (IP, userAgent, old/new role, ...) |

### 4.1 ndices

| Nombre | Columnas | Propsito |
|---|---|---|
| `audit_log_pkey` | `id` | PK |
| `identity_audit_log_occurred_at_idx` | `(occurred_at DESC)` | Time-range scans |
| `identity_audit_log_subject_idx` | `(subject_user_id, occurred_at DESC) WHERE subject_user_id IS NOT NULL` | Partial index; per-user history |
| `identity_audit_log_action_idx` | `(action, occurred_at DESC)` | Action-type reports |

### 4.2 Escritura desde el service layer (ADR-015)

> El `user-service.ts` escribe en `audit_log` dentro de la **misma
> transaccin** que la mutacin de `users` (cuando aplica) o antes del
> read (para `getUser` / `listUsers`). Ver [ADR-015](./adr/015-audit-log-writes.md).
>
> **9 acciones** cubiertas: `user.registered`, `user.login`,
> `user.profile_viewed`, `user.profile_updated`, `user.password_changed`,
> `user.deactivated`, `user.activated`, `user.role_changed`,
> `user.list_viewed`. Los `deactivate/activate` idempotentes (estado ya
> en el valor deseado) **no** escriben audit row. Los intentos de
> login fallidos **no** escriben audit row (evita user-enumeration).

---

## 5. `public.spark_match_migrations` (V001)

**Migracin**: [V001__create_identity_schema_and_tracking.sql](../migrations/V001__create_identity_schema_and_tracking.sql).

Tabla de tracking del migrator (`node-pg-migrate`). Pre-creada por V001
para que la primera aplicacin tenga la tabla ya presente (los dems
migrators la esperan).

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `name` | `TEXT` | no | — | PK; nombre del archivo de migracin (ej. `V002__create_users_table.sql`) |
| `run_on` | `TIMESTAMPTZ` | no | `current_timestamp` | Cuando se aplic |

No tiene ndices adicionales (PK basta para lookups por nombre).

---

## 6. Mapping TypeScript ↔ SQL

Cada repositorio declara su `Database` type en
`contexts/<ctx>/src/infra/<repo>.ts`. Para Identity:

```ts
// contexts/identity/src/infra/user-repository.ts:18
export interface Database {
  users: {
    id: string;
    email: string;
    full_name: string;
    password_hash: string;
    age: number | null;
    role: UserRole;
    active: boolean;
    created_at: Date;
    updated_at: Date;
  };
}
```

**Importante**: `Database` declara `users` en el root, no
`identity.users`. Kysely usa `withSchema('identity')` en cada query para
calificar el schema sin perder el type-level link.

**Regla**: cuando se aade una columna a `identity.users`, actualizar en
el mismo PR:

1. La migracin SQL (`migrations/V00N__...sql`).
2. El type `Database.users` en `user-repository.ts`.
3. El type `User` en `contexts/identity/src/domain/user.ts`.

Tres sitios, un PR.

---

## 7. Reglas de modelado (anti-patrones prohibidos)

| Regla | Por qu |
|---|---|
| **Nunca** hard-delete users. Usar `active = FALSE`. | Preserva FKs histricas y audit_log |
| **Nunca** aadir `users.role` con un valor que no est en el `CHECK` constraint | Rompe invariantes |
| **Nunca** omitir el ndice `(active, email)` en una nueva tabla `users`-like | Hot path de `listUsers` |
| **Nunca** cambiar `audit_log.action` de `TEXT` a `ENUM` | Enum requiere migracin por cada nuevo action; texto permite evolucin |
| **Nunca** hacer `audit_log` UPDATE o DELETE desde la app | Compliance (futuro: `REVOKE UPDATE, DELETE`) |
| **Nunca** compartir tablas entre contextos | Si dos contextos necesitan los mismos datos, modelar como dos tablas sincronizadas por evento |

---

## 8. Backlog conocido

| Item | Severidad | Descripcin |
|---|---|---|
| `audit_log` UPDATE/DELETE permission | P2 | `REVOKE UPDATE, DELETE ON identity.audit_log FROM <app_role>` (compliance) |
| `audit_log` retention policy | P2 | Partition por mes + archive a S3 (crecimiento indefinido) |
| `users.created_at` index | P3 | `listUsers` orderBy por `created_at` es sequential scan hoy. Aceptable para MVP. |
| `password_history` / `password_expiry` | P3 | Si se aaden, requiere columna + CHECK constraint migration |
| `updated_by` column | P3 | Hoy `updated_at` se toca pero no sabemos quin. Complementa `audit_log`. |
| GET /v1/audit (admin) | P3 | Hoy el audit_log es write-only; no hay endpoint de lectura. |
| Future contexts (Assessment, Career, Matching) | P2 | Cuando aterricen, replicar el patrn schema-per-context + `Database` type por repositorio |

---

## 9. Referencias cruzadas

- [runtime-topology.md § 5](./runtime-topology.md#5-database-topology--aurora-postgresql-serverless-v2)
  — topologa runtime (credenciales, VPC, capa RDS CA, env vars).
- [architecture.md § 6.2](./architecture.md) — storage strategy a nivel arquitectura.
- [migrations/](../migrations/) — SQL source of truth.
- [contexts/identity/src/infra/user-repository.ts](../contexts/identity/src/infra/user-repository.ts) — `Database` type.
- [event-catalog.md](./event-catalog.md) — eventos que pueden disparar escrituras en `audit_log` (futuro).