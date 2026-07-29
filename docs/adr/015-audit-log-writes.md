# ADR-015: Audit log writes for user mutations (sync, in-transaction)

**Estado**: Aceptado · **Fecha**: 2026-07-29

### Contexto

La tabla `identity.audit_log` se cre en 004 (Sprint 1) con la promesa de
"inserted by the service layer from the **same transaction** as the change"
(`migrations/004_create_audit_log.sql:5-7`). Sin embargo, ningn
service handler escribe audit rows hoy.

Tres problemas concretos:

1. **Privacidad / GDPR**: no hay trazabilidad de quin accedi a quin, cundo
   y desde dnde. El reg. UE 2016/679 (Art. 30) exige un registro de las
   actividades de tratamiento para datos personales.
2. **Forensics**: ante un incidente (cuenta comprometida, admin malicioso)
   no hay forma de reconstruir quin desactiv una cuenta o cambi un
   password.
3. **Backlog de docs**: `docs/data-model.md:250`, `docs/runbook.md:378` y
   `docs/use-cases.md:393` marcan el gap como **P1**.

El endpoint admin `PATCH /v1/users/{userId}` (PR #32) actualmente acepta
`role` y `active` en el body, pero `user-service.ts:196-239` solo
forwarda `fullName/age` al repo. La mutacin admin de `role`/`active`
queda como latent vector de auditora.

### Opciones consideradas

| Opcin | Pros | Contras |
|---|---|---|
| **Sync writes in same transaction** | Atomicidad real (004); no hay rows fantasma | Ms latencia (~3ms); requiere tx wrapper |
| Async writes (fire-and-forget) | No bloquea el handler | Pierde audit rows ante crash; viola 004 |
| Async writes via EventBridge consumer | Desacopla; escala | EventBridge eventually-consistent; gap forensics |
| Log-only (CloudWatch) | Sin cambios en DB | No queryable; no preservable post-rotation |

### Decisin

**Sync writes dentro de la misma transaccin que la mutacin de `users`**,
cubriendo **9 acciones**:

| Action | Trigger | Sujeto | Actor | Metadata |
|---|---|---|---|---|
| `user.registered` | `register` | new user.id | null (anonymous) | `{ email, role }` |
| `user.login` | `authenticate` (success) | user.id | null (anonymous) | `{ ip, userAgent }` |
| `user.profile_viewed` | `getUser` | target.id | actor.id | `{}` |
| `user.profile_updated` | `updateUser` | target.id | actor.id | `{ changedFields, old, new }` |
| `user.password_changed` | `changePassword` | target.id | actor.id | `{}` |
| `user.deactivated` | `deactivateUser` (transition) | target.id | actor.id | `{}` |
| `user.activated` | `activateUser` (transition) | target.id | actor.id | `{}` |
| `user.role_changed` | `updateUser` (role diff) | target.id | actor.id | `{ oldRole, newRole }` |
| `user.list_viewed` | `listUsers` | null | actor.id | `{ filterCount, returnedCount }` |

**Naming**: dot.notation (`user.registered`, `user.password_changed`)
para coincidir con el ejemplo de 004 (`migrations/004_create_audit_log.sql:18`)
y ser grep-friendly.

**Transacciones**: se introduce un `withTransaction(fn)` helper
(`contexts/identity/src/infra/transaction.ts`) que envuelve la mutacin
de `users` + la insercin en `audit_log` en una sola `db.transaction()`.
Para operaciones read-only (`getUser`, `listUsers`) tambin se usa
transaccin (con un solo `audit_log.insert`) para mantener consistencia
del cdigo.

**Idempotencia**: `deactivateUser`/`activateUser` ya short-circuitean
cuando el target est en el estado deseado (`user-service.ts:247-249,
266-268`). El audit write sigue la misma lgica: **no se escribe audit
row si no hubo transicin real**.

**Login audit**: `user.login` se escribe solo en **xito** (no en
credenciales incorrectas, no en cuenta desactivada). Esto evita un
vector de user-enumeration via timing del audit log.

**Database type**: `Database` interface se extrae de
`contexts/identity/src/infra/user-repository.ts` a
`contexts/identity/src/infra/database.ts` para compartir entre
`user-repository.ts` y `audit-repository.ts`. La tabla `audit_log` se
aade al `Database` interface.

**Repositorio**: `audit-repository.ts` sigue el patrn de
`user-repository.ts` (factory `createAuditRepository(db)`, error
mapping `withDbErrorMapping('audit_log.insert', ...)`, snake_case
DB row → camelCase domain type).

**Tipo de transaccin**: ambos repos (`user-repository.ts`,
`audit-repository.ts`) reciben un parmetro `db` que puede ser
`Kysely<Database>` o `Transaction<Database>`. Kysely nativamente
soporta `Transaction<Database>` con la misma API.

### Consecuencias

**Positivas**:
- Cumplimiento GDPR Art. 30 (registro de actividades de tratamiento)
- Traceability completa: cada mutacin y read de user deja un audit row
- Forensic capability: ante incidente, se puede reconstruir la historia
- Latency predecible: tx wrapper agrega ~2-3ms (single-digit ms)
- Set precedent: el tx wrapper se reutiliza para futuras operaciones
  multi-tabla (career assessments, matching scores)

**Negativas**:
- Latency adicional (~2-3ms por mutacin) — aceptable dentro del SLO
  (p99 < 200ms para auth)
- Tx failure aborts user mutation — esto es **deseable** (evita
  divergencia entre `users` y `audit_log`)
- Audit_log crece indefinidamente — necesita retention policy futura
  (P2: partition por mes, archive a S3)

**Mitigaciones**:
- Indexes ya existentes en 004 cubren queries esperadas
  (per-user history, action-type reports)
- `audit_log` es append-only (004:20-21); no UPDATE/DELETE en SQL
- Compliance puede revocar UPDATE/DELETE con una migracin futura
  (mencionado en 004:21)

### Out of scope (track elsewhere)

- **Retention policy** (P2): partition por mes + archive a S3
- **Compliance revoke UPDATE/DELETE** (P2): GRANT SELECT-only a role
  de aplicacin
- **Audit log admin UI** (P3): endpoint `GET /v1/audit` para admins
- **No PII minimization**: el `metadata` JSONB puede contener PII
  (email, role). Para P1 esto es aceptable; revisit en P3 con GDPR
  pseudonymization

### Referencias

- `migrations/004_create_audit_log.sql` — schema y comentario
  "same transaction" mandating
- `docs/data-model.md:73-94, 240-241, 250` — gap documented
- `docs/runbook.md:378` — backlog ticket
- `docs/use-cases.md:393` — per-use-case gap note
- `AGENTS.md` — quality gates (80/80/80/80 coverage, zero smells)
- ADR-011 — establece el patrn DynamoDB idempotency (no aplica aqu;
  audit_log es PostgreSQL)
