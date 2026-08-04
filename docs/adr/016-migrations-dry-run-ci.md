# ADR-016: migrations-dry-run CI job (sequence validation)

**Estado**: Aceptado · **Fecha**: 2026-07-29

### Contexto

El backend tiene 4 migraciones SQL (`migrations/001..004_*.sql`)
aplicadas por `node-pg-migrate` tanto en local (npm script) como en
produccin (Lambda `migrate.handler`). No existe validacin
automtica de la *secuencia* de migraciones: si 003 declara una
columna con un CHECK constraint y 004 intenta un INSERT que la
viola, el bug se descubre solo cuando el migrator en produccin
falla, momento en el que la siguiente smoke test rompe y la pipeline
se estanca.

Esto fue explcitamente marcado como P2 en:
- `docs/data-model.md` (backlog de Quality)
- `docs/runbook.md` (Sprint 2 backlog)
- `BACKEND-UPGRADE.md` / `SONARCLOUD-CI-IMPROVEMENTS.md` (Bloque 4)

La solucin natural es un job CI que aplique las migraciones contra
un Postgres fresco y aborte el PR si alguna falla.

### Opciones consideradas

| Opcin | Pros | Contras |
|---|---|---|
| **Reusable workflow del devops repo con `postgres` service container** | Sin infraestructura nueva; matches `node-pg-migrate` real; cero credenciales AWS; idempotente | El recipe pre-existente tenía bugs (tracking table con default heredado del proyecto legado pre-rebrand, ORDER BY id inexistente) |
| Static analysis del SQL (regex por DROP, DELETE sin WHERE, etc.) | Sin DB; ms rpido | Falsos positivos; no detecta bugs de sequence reales (ej. INSERT que viola CHECK anterior) |
| `node-pg-migrate --dryRun` en el Lambda handler | Reusa cdigo existente | El Lambda handler usa `MIGRATE_DATABASE_URL` (no `DATABASE_URL`); requiere un secreto en CI; no es atmico fresh-DB |
| Round-trip (up, down, up) | Detecta problemas de reversibilidad | El 100% de las migraciones SQL actuales son one-way (no `*.down.sql`); no aporta ahora |

### Decisin

**Caller wrapper en `spark-match-03-backend/.github/workflows/ci.yml`
que invoca el reusable workflow `migrations-dry-run.yml` del devops
repo**, con las siguientes overrides:

| Input | Default del recipe | Override del backend |
|---|---|---|
| `environment-name` | `dev` | `ci` |
| `postgres-version` | `17` | `17` (default) |
| `postgres-user` | `postgres` | `postgres` (default) |
| `postgres-password` | `postgres` | `postgres` (default) |
| `postgres-db` | *(default heredado del proyecto legado pre-rebrand)* | `spark_match_test` |
| `migrations-dir` | `migrations` | `migrations` (default) |
| `migrations-table` | *(default heredado del proyecto legado pre-rebrand)* | **`spark_match_migrations`** (matches `node-pg-migrate` scripts en `package.json:30-34` y 001) |
| `migrations-schema` | `public` | `public` (default) |
| `node-version` | `24` | `24` (default) |
| `working-directory` | `.` | `.` (default) |
| `npm-script` | `migrate:up` | `migrate:up` (default) |
| `timeout-minutes` | `10` | `10` (default) |

**El job**:

1. Spins up `postgres:17` service container.
2. Espera a `pg_isready`.
3. Runs `npm ci` en el backend.
4. Ejecuta `npm run migrate:up` con `DATABASE_URL=postgres://...`
   apuntando al container.
5. Reporta las migraciones aplicadas al GitHub Step Summary.

**Triggers**: `pull_request` a `main` y `dev` (match al CI existente).

**Sin secretos**: no se reusan `MIGRATE_DATABASE_URL`, Aurora RDS, ni
Secrets Manager. La DB es un container throwaway.

**No `needs`**: el job corre en paralelo con SonarCloud + CodeQL.
Si falla, el PR queda en rojo independientemente del QG.

**Por qu no usamos el Lambda handler**: el handler lee
`MIGRATE_DATABASE_URL` (`contexts/identity/src/handlers/migrate.ts:69-71`).
Inyectar ese env var en CI requerira un secreto. El recipe apunta
`DATABASE_URL` directamente. Mantener el handler como est significa
tener dos paths paralelos (Lambda handler + npm script) que no se
pueden testear juntos. **Aceptable trade-off** porque las migraciones
SQL son idempotentes y el recipe usa el mismo `node-pg-migrate` CLI.

### Known issues en el recipe (de momento aceptados)

1. **`ORDER BY id` en el summary query** (`migrations-dry-run.yml:282-295`)
   apunta a una columna que 001 no tiene. El recipe lo wrapea en
   `|| echo "::warning::..."` entonces no falla, pero el summary
   mostrar warning en lugar de las migraciones aplicadas. **Fix**:
   crear PR a devops que cambie `ORDER BY id` por `ORDER BY run_on, name`.
   Out of scope de este PR (mantener el PR de backend fnico).

2. **004 audit_log y permisos de aplicacin** (preexistente del
   PR #70): 004 no tiene `GRANT` statements. Asume que la app y el
   migrator usan el mismo rol (master credentials). Si en el futuro
   se introduce un rol segregado, esta migracin ser insuficiente.
   **Backlog**: aadir `GRANT USAGE ON SCHEMA identity` +
   `GRANT INSERT ON identity.audit_log` en una 005 cuando se
   segregen roles.

3. **Round-trip up/down/up no se ejecuta**: las 4 migraciones
   actuales son `one-way` (no hay archivos `*.down.sql`). El recipe
   solo hace `up`. Si en el futuro se agregan `*.down.sql`, el
   round-trip debera aadirse al caller o al recipe.

### Consecuencias

**Positivas**:
- Bugs de secuencia (CHECK constraints, FK roto, idempotencia
  fallida) se detectan en PR time, no en produccin.
- Cero infraestructura nueva (reusa `migrations-dry-run.yml` del devops repo).
- No requiere secretos AWS ni acceso a RDS en CI.
- Set precedent para que otros repos (career, assessment, matching,
  notifications) reusen el mismo recipe.

**Negativas**:
- 1-2 min adicionales de CI time por PR (start container + npm ci).
- No detecta migraciones "visualmente correctas" pero funcionalmente
  malas contra los datos de produccin (e.g. INSERT que pasa el
  psql syntax check pero rompe un INDEX delicado). Eso requerir
  integration tests con datos sintticos.

**Mitigaciones**:
- El devops recipe espera a `pg_isready` antes de conectar.
- `npm ci` falla si hay lockfile desincronizado (fails fast).
- `migrate:up` retorna non-zero en cualquier fallo (no se traga errors).

### Referencias

- `migrations/001_create_identity_schema_and_tracking.sql` — schema,
  tracking table `spark_match_migrations`
- `migrations/002..004_*.sql` — users, RBAC, audit_log
- `package.json:30-34` — scripts `migrate:up`/`migrate:down`/`migrate:status`
- `contexts/identity/src/handlers/migrate.ts` — Lambda migrator
- `template.yaml` (identity nest) — `MIGRATE_DATABASE_URL` from SSM
- `spark-match-01-devops/.github/workflows/migrations-dry-run.yml` — reusable recipe
- `docs/runbook.md` (Sprint 2 backlog) — Sprint 2 migration automation
