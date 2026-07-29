# Use Cases — Spark Match Backend (Identity Context)

> Catlogo de casos de uso del contexto **Identity** (nico contexto live).
> Cada caso documenta: actor, precondiciones, postcondiciones, efectos
> colaterales (DB + EventBridge + audit), status codes.
>
> Para el HTTP body shape ver [api.md](./api.md). Para errores ver
> [error-catalog.md](./error-catalog.md). Para RBAC detallado ver
> [auth-rbac.md](./auth-rbac.md).

Last reviewed: 2026-07-28.

---

## UC-1. Registrar usuario

**Handler**: [`register.ts`](../contexts/identity/src/handlers/register.ts)  
**Ruta**: `POST /v1/auth/register`  
**Actor**: anonymous  
**Auth**: no requerida.

**Precondiciones**:
- Body: `{ email, password, fullName, age? }` con `email` lowercase,
  `password` 8..100 chars, `fullName` 2..200, `age` 13..120.

**Postcondiciones**:
- Nueva fila en `identity.users` con `id = UUID v4`, `role = 'admin'`
  (default 003), `active = true`.
- `identity.users.password_hash` = `scrypt$N$r$p$salt$hash`.

**Efectos colaterales**:
- **EventBridge**: publica `UserRegistered` (`detail-type: UserRegistered`,
  source `spark-match.identity`). Ver [event-catalog.md § 2.1](./event-catalog.md).
- **`identity.audit_log`**: inserta `user.registered` (actor=null,
  subject=newUser.id, metadata={email, role}). Ver [data-model.md § 4.2](./data-model.md).

**Status codes**:

| Status | Cuando |
|---|---|
| 200 | Registro exitoso (response: `{ id, email, fullName, createdAt }`) |
| 400 | Body invlido (Zod `validation.*`) |
| 409 | Email ya registrado (`user.email_taken`) |
| 500 | Internal |
| 503 | DB o EventBridge no disponible (`db.*`, `aws.*`) |

---

## UC-2. Autenticar (login)

**Handler**: [`login.ts`](../contexts/identity/src/handlers/login.ts)  
**Ruta**: `POST /v1/auth/login`  
**Actor**: anonymous  
**Auth**: no requerida.

**Precondiciones**:
- Body: `{ email, password }` con `email` lowercase, `password` 8..100.

**Postcondiciones**:
- JWT firmado con HS256, TTL 24 h, claims `{ sub: userId, email, role }`.

**Efectos colaterales**:
- **EventBridge**: publica `UserLoggedIn`. Ver
  [event-catalog.md § 2.2](./event-catalog.md).

**Status codes**:

| Status | Cuando |
|---|---|
| 200 | Credenciales vlidas (response: `{ accessToken, expiresIn: 86400, user: { id, email, fullName } }`) |
| 400 | Body invlido |
| 401 | Email no existe o password no coincide (mensaje genrico "Invalid credentials" — no se filtra cul) |
| 403 | Cuenta con `active = false` (mensaje "Account is deactivated"). Ver nota abajo. |
| 503 | DB o Secrets Manager no disponible |

**Nota 403 vs 401**: la cuenta desactivada devuelve **403** (no 401) por
diseo — un admin interno que conoce la cuenta desactivada puede
remediarla via API admin (`activate-user`). Un atacante no obtiene
informacin sobre si la cuenta existe (mensaje neutro en 401).

---

## UC-3. Obtener perfil propio

**Handler**: [`get-me.ts`](../contexts/identity/src/handlers/get-me.ts)  
**Ruta**: `GET /v1/users/me`  
**Actor**: self  
**Auth**: requerida (Authorizer wired en template.yaml solo para `PATCH /me`; `GET /me` depende del middleware).

**Precondiciones**:
- Authorization: Bearer JWT vlido.
- `sub` del JWT = userId del usuario activo.

**Postcondiciones**:
- Devuelve `PublicUser` (sin `passwordHash`).

**Efectos colaterales**: ninguno.

**Status codes**:

| Status | Cuando |
|---|---|
| 200 | (response: `PublicUser`) |
| 401 | Sin auth o JWT invlido |
| 403 | Cuenta desactivada |
| 503 | DB no disponible |

---

## UC-4. Actualizar perfil propio

**Handler**: [`update-profile.ts`](../contexts/identity/src/handlers/update-profile.ts)  
**Ruta**: `PATCH /v1/users/me`  
**Actor**: self (fullName/age only) o admin  
**Auth**: requerida, **wireada al Authorizer** (la nica ruta que lo est).

**Precondiciones**:
- Authorization: Bearer JWT vlido.
- Body: `{ fullName?, age? }` con al menos un campo no-vaco.
- `role` y `active` **no permitidos** en body (auto-rechazo si se envan).

**Postcondiciones**:
- Fila actualizada en `identity.users`; `updated_at` auto-touched por
  trigger.

**Efectos colaterales**:
- **EventBridge**: publica `UserUpdated` con `changes: { ...input }`. Ver
  [event-catalog.md § 2.4](./event-catalog.md).
- **No** se emite `UserRoleChanged` aunque el body incluyera `role`
  (rechazado antes).

**Status codes**:

| Status | Cuando |
|---|---|
| 200 | Update exitoso (response: `PublicUser`) |
| 400 | Body vaco (`validation.empty_changes`) o Zod invlido |
| 401 | Sin auth o JWT invlido |
| 403 | Cuenta desactivada o intento de cambiar propio `role`/`active` |
| 503 | DB no disponible |

---

## UC-5. Actualizar usuario (admin)

**Handler**: [`update-user.ts`](../contexts/identity/src/handlers/update-user.ts)  
**Ruta**: `PATCH /v1/users/{userId}`  
**Actor**: admin  
**Auth**: requerida (middleware, Authorizer no wireado).

**Precondiciones**:
- Authorization: Bearer JWT vlido con `role === 'admin'`.
- `userId` en path.
- Body: `{ fullName?, age?, role?, active? }` con al menos un campo.

**Postcondiciones**:
- Fila actualizada.

**Efectos colaterales**:
- **EventBridge**: publica `UserUpdated`. **Adems**, si el admin cambi
  `role`, publica `UserRoleChanged`. Ver
  [event-catalog.md § 2.4 y § 2.7](./event-catalog.md).

**Status codes**:

| Status | Cuando |
|---|---|
| 200 | (response: `PublicUser`) |
| 400 | Body vaco o `userId` faltante |
| 401 | Sin auth o JWT invlido |
| 403 | Cuenta desactivada o no-admin-no-self |
| 404 | `userId` no existe |
| 503 | DB o EventBridge no disponible |

---

## UC-6. Cambiar password propio

**Handler**: [`change-password.ts`](../contexts/identity/src/handlers/change-password.ts)  
**Ruta**: `PUT /v1/users/me/password`  
**Actor**: self  
**Auth**: requerida (middleware).

**Precondiciones**:
- Authorization: Bearer JWT vlido.
- Body: `{ newPassword }` (8..100 chars).

**Postcondiciones**:
- `identity.users.password_hash` reemplazado por nuevo scrypt hash.

**Efectos colaterales**:
- **EventBridge**: publica `UserPasswordChanged`. Ver
  [event-catalog.md § 2.3](./event-catalog.md).
- **JWT actual sigue vlido** hasta su `exp` (24 h). No hay revocacin
  forzada — el usuario puede seguir usando el token viejo. Ver
  [auth-rbac.md § 1](./auth-rbac.md).

**Status codes**:

| Status | Cuando |
|---|---|
| 200 | (response: `{ message: "password updated" }`) |
| 400 | Body invlido |
| 401 | Sin auth o JWT invlido |
| 403 | Cuenta desactivada |
| 503 | DB no disponible |

---

## UC-7. Listar usuarios (admin)

**Handler**: [`list-users.ts`](../contexts/identity/src/handlers/list-users.ts)  
**Ruta**: `GET /v1/users`  
**Actor**: admin  
**Auth**: requerida (middleware).

**Query params**:

| Param | Tipo | Default | Rango | Notas |
|---|---|---|---|---|
| `limit` | integer | `20` | 1..100 | Paginacin |
| `cursor` | string | — | opaque | Continuar paginacin |
| `active` | enum | — | `true`/`false`/`all` | Filtro por active |
| `role` | enum | — | `admin` (nico hoy) | Filtro por role |

**Status codes**:

| Status | Cuando |
|---|---|
| 200 | (response: `{ users: PublicUser[], nextCursor: string|null }`) |
| 400 | Query param fuera de rango (`validation.invalid_limit`, etc.) |
| 401 | Sin auth o JWT invlido |
| 403 | Cuenta desactivada o `role !== 'admin'` |
| 503 | DB no disponible |

---

## UC-8. Activar usuario (admin)

**Handler**: [`activate-user.ts`](../contexts/identity/src/handlers/activate-user.ts)  
**Ruta**: `POST /v1/users/{userId}/activate`  
**Actor**: admin  
**Auth**: requerida (middleware).

**Precondiciones**:
- JWT admin vlido.
- `userId` en path.

**Postcondiciones**:
- `identity.users.active = true`.

**Efectos colaterales**:
- **EventBridge**: publica `UserActivated` **solo si** el target estaba
  `active = false`. Si ya estaba activo, **no-op** (sin DB write, sin
  evento). Ver [event-catalog.md § 2.5](./event-catalog.md).

**Status codes**:

| Status | Cuando |
|---|---|
| 200 | (response: `PublicUser`) |
| 400 | `userId` faltante en path |
| 401 | Sin auth o JWT invlido |
| 403 | Cuenta desactivada o no-admin |
| 404 | `userId` no existe |
| 503 | DB o EventBridge no disponible |

---

## UC-9. Desactivar usuario (admin)

**Handler**: [`deactivate-user.ts`](../contexts/identity/src/handlers/deactivate-user.ts)  
**Ruta**: `POST /v1/users/{userId}/deactivate`  
**Actor**: admin  
**Auth**: requerida (middleware).

**Precondiciones**:
- JWT admin vlido.
- `userId` en path.
- **`userId != auth.userId`** (self-deactivation prohibida).

**Postcondiciones**:
- `identity.users.active = false`.

**Efectos colaterales**:
- **EventBridge**: publica `UserDeactivated` solo si transicin efectiva
  (active: true → false). Si ya estaba inactivo, **no-op** sin DB write
  ni evento. Ver [event-catalog.md § 2.6](./event-catalog.md).

**Status codes**:

| Status | Cuando |
|---|---|
| 200 | (response: `PublicUser`) |
| 400 | `userId` faltante |
| 401 | Sin auth o JWT invlido |
| 403 | Cuenta desactivada, no-admin, o self-deactivation |
| 404 | `userId` no existe |
| 503 | DB o EventBridge no disponible |

---

## UC-10. Ejecutar migraciones (operacional)

**Handler**: [`migrate.ts`](../contexts/identity/src/handlers/migrate.ts)  
**Ruta**: NO HTTP. Direct invoke via AWS CLI / SDK.  
**Actor**: CI/CD role o dev workstation con `lambda:InvokeFunction` permission.  
**Auth**: IAM-only.

**Input** (JSON):

```json
{ "direction": "up" | "down" | "status" }
```

**Output**:

```json
{
  "direction": "up",
  "applied": ["003_add_role_and_active_to_users.sql"],
  "log": ["== 003: migrating =======", "..."]
}
```

**Direcciones**:
- `up`: aplica migrations pendientes (default).
- `down`: revierte la ltima migration.
- `status`: lista aplicadas/pendientes sin aplicar nada.

**Status codes**: API Gateway no aplica. El handler lanza `ApiError` con
cualquier problema (Zod validation, MIGRATE_DATABASE_URL faltante, error
de pg). El caller recibe el error via `aws lambda invoke` response.

**Ver [runbook.md § 3](./runbook.md) para el procedimiento operacional.**

---

## UC-11. Verificar JWT (Authorizer Lambda)

**Handler**: [`authorizer.ts`](../contexts/identity/src/handlers/authorizer.ts)  
**Ruta**: NO HTTP. Invocado por API Gateway antes de la ruta protegida.  
**Actor**: API Gateway (en representacin del cliente HTTP).  
**Auth**: Bearer JWT en `Authorization` header.

**Precondiciones**:
- Header `Authorization: Bearer <jwt>` presente.

**Postcondiciones (success)**:

```json
{
  "isAuthorized": true,
  "context": { "userId": "...", "email": "...", "role": "..." }
}
```

**Postcondiciones (failure)**:

```json
{ "isAuthorized": false }
```

API Gateway rechaza la peticin downstream con 401 si `isAuthorized:
false`. Si true, el contexto se adjunta a
`event.requestContext.authorizer.lambda` para el handler.

**Notas**:
- Simple Response format (HTTP API v2 payload format 2.0). No requiere
  IAM `lambda:InvokeFunction` en downstream Lambdas.
- `AuthorizerResultTtlInSeconds: 0` — no cache. Cada peticin re-verifica.
- Si el JWT falla, el Authorizer NO distingue razn (log warning pero
  respuesta uniforme `isAuthorized: false`).

---

## Resumen: tabla de casos de uso

| # | Use case | Actor | Eventos emitidos | DB tables tocadas |
|---|---|---|---|---|
| UC-1 | Register | anonymous | `UserRegistered` | `users` (insert) |
| UC-2 | Login | anonymous | `UserLoggedIn` | `users` (read) |
| UC-3 | Get me | self | — | `users` (read) |
| UC-4 | Update profile | self | `UserUpdated` | `users` (update) |
| UC-5 | Update user (admin) | admin | `UserUpdated`, `UserRoleChanged` (si role cambi) | `users` (update), `audit_log` (`user.profile_updated`, `user.role_changed` si aplica) |
| UC-6 | Change password | self | `UserPasswordChanged` | `users` (update password_hash), `audit_log` (`user.password_changed`) |
| UC-7 | List users | admin | — | `users` (read paginated), `audit_log` (`user.list_viewed`) |
| UC-8 | Activate user | admin | `UserActivated` (si transicin efectiva) | `users` (update active), `audit_log` (`user.activated` si transicin) |
| UC-9 | Deactivate user | admin | `UserDeactivated` (si transicin efectiva) | `users` (update active), `audit_log` (`user.deactivated` si transicin) |
| UC-10 | Migrate (ops) | IAM | — | `public.spark_match_migrations` + todas |
| UC-11 | Authorize | API GW | — | Secrets Manager (read JWT secret) |

**Audit log writes**: todas las mutaciones + `getUser` + `listUsers` escriben
un row en `identity.audit_log` dentro de la misma transaccin que la
operacin. Las transiciones idempotentes (deactivate/activate cuando el
estado ya es el deseado) **no** escriben audit row. Los intentos de
login fallidos **no** escriben audit row (evita user-enumeration). Ver
[ADR-015](./adr/015-audit-log-writes.md) y [data-model.md § 4.2](./data-model.md).