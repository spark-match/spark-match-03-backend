# Error Catalog — Spark Match Backend

> Single source of truth para los errores HTTP que devuelve la API.
> Cubre los **cdigos top-level** (`error.code`), los **detail codes**
> (`error.details[].code`), y la matriz handler × HTTP status.
>
> Para el contrato de envelope (success/error response shape) ver
> [`shared/src/http/api-response.ts`](../shared/src/http/api-response.ts) y
> [`shared/src/http/api-error.ts`](../shared/src/http/api-error.ts).
>
> Para el HTTP body envelope (request/response) ver [api.md](./api.md).

Last reviewed: 2026-07-28.

---

## 1. Response envelope

**xito**:

```json
{
  "success": true,
  "data": { /* payload */ },
  "meta": { "requestId": "uuid", "timestamp": "2026-..." }
}
```

**Error**:

```json
{
  "success": false,
  "error": {
    "code": "bad_request",
    "message": "Validation failed",
    "details": [
      {
        "code": "validation.invalid_type",
        "message": "Expected string, received number",
        "path": "email",
        "value": 42
      }
    ]
  },
  "meta": { "requestId": "uuid", "timestamp": "2026-..." }
}
```

**Reglas del contrato**:
- `error.details` es **siempre** un array no-vaco. Si el error original
  no provee detalles, se sintetiza uno a partir de `code` + `message`.
- `meta.requestId` siempre presente; AWS Lambda provee el ID, fallback
  es la string literal `"unknown"`.
- `error.code` es **estable** (no localized, no cambia con la versin del
  mensaje). Los clientes deben hacer dispatch sobre `code`, nunca sobre
  `message`.

---

## 2. Cdigos top-level (HTTP status ↔ `error.code`)

Tabla `defaultCodeForStatus` en [`api-error.ts:165`](../shared/src/http/api-error.ts):

| HTTP Status | `error.code` | Default message |
|---|---|---|
| `400` | `bad_request` | "Bad request" |
| `401` | `unauthorized` | "Unauthorized" |
| `403` | `forbidden` | "Forbidden" |
| `404` | `not_found` | "<resource> not found" |
| `409` | `conflict` | "Conflict" |
| `422` | `unprocessable_entity` | "Unprocessable entity" |
| `429` | `too_many_requests` | "Too many requests" |
| `500` | `internal` | "Internal server error" |
| `503` | `service_unavailable` | "Service unavailable" |

Cdigos `422` y `429` estn definidos pero **no se lanzan en el cdigo
actual** (reservados para uso futuro).

---

## 3. Detail codes por taxona

Sufijo dotted, semntico. Cliente dispatcha sobre estos sin parsear
mensajes.

### 3.1 `validation.*` — Zod / request body errors

Generados por [`ApiError.fromZodError()`](../shared/src/http/api-error.ts:152)
a partir de `$ZodIssue.code` de Zod 4. Cada Zod issue produce un detail.

| Detail code | Origen Zod | Cuando |
|---|---|---|
| `validation.invalid_type` | `invalid_type` | Campo con tipo incorrecto |
| `validation.too_small` | `too_small` | String/array/number menor que el mnimo |
| `validation.too_big` | `too_big` | String/array/number mayor que el mximo |
| `validation.invalid_format` | `invalid_format` | `z.email()`, `z.uuid()`, `z.url()`, etc. |
| `validation.invalid_value` | `invalid_value` | Valor fuera de un enum / literal |
| `validation.unrecognized_keys` | `unrecognized_keys` | Campos extra no permitidos |
| `validation.not_multiple_of` | `not_multiple_of` | `z.multipleOf()` |
| `validation.custom` | `custom` | `.refine()` fallido |

**Path**: dotted notation del campo, ej `address.city`, `users[0].email`.

### 3.2 `user.*` — business rules sobre users

| Detail code | HTTP | Cuando |
|---|---|---|
| `user.email_taken` | `409` | `register` cuando el email ya existe (lowercase match) |

### 3.3 `aws.*` — upstream AWS dependencies

| Detail code | HTTP | Cuando |
|---|---|---|
| `aws.unavailable` | `503` | SSM / Secrets Manager / EventBridge falla. `meta.dependency` indica cul. |

`meta` tpico:
```json
{ "dependency": "SSM" }
{ "dependency": "Secrets Manager" }
{ "dependency": "EventBridge" }
```

### 3.4 `db.*` — downstream database

| Detail code | HTTP | Cuando |
|---|---|---|
| `db.unavailable` | `503` | Kysely query / pg connection falla. `meta.operation` indica cul. |

`meta` tpico:
```json
{ "operation": "users.findByEmail" }
{ "operation": "users.create" }
```

### 3.5 Custom validation (no generados por Zod)

Algunos handlers lanzan 400 con detail codes hand-rolled:

| Detail code | HTTP | Handler | Cuando |
|---|---|---|---|
| `validation.empty_changes` | `400` | `update-profile`, `update-user` | El body no incluye ningn campo modificable |
| `validation.invalid_limit` | `400` | `list-users` | `limit` query param fuera de `[1, 100]` |
| `validation.invalid_active` | `400` | `list-users` | `active` query param no es `true`/`false`/`all` |
| `validation.invalid_role` | `400` | `list-users` | `role` query param no est en `USER_ROLES` |

### 3.6 `internal.*` — errores no esperados

| Detail code | HTTP | Cuando |
|---|---|---|
| `internal.unknown` | `500` | Cualquier `throw` que **no** sea `ApiError`. El log interno tiene el stack real; la respuesta al cliente es genrica (no se filtra el mensaje original). |

---

## 4. Matriz handler × HTTP status × code

| Handler | Ruta | Mtodo | 200 | 400 | 401 | 403 | 404 | 409 | 500 | 503 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `register` | `/v1/auth/register` | POST | ✅ | `bad_request` (`validation.*`) | — | — | — | `conflict` (`user.email_taken`) | `internal` | `service_unavailable` (`db.*` / `aws.*`) |
| `login` | `/v1/auth/login` | POST | ✅ | `bad_request` (`validation.*`) | `unauthorized` (creds invlidas) | `forbidden` (cuenta `active=false`) | — | — | `internal` | `service_unavailable` |
| `get-me` | `/v1/users/me` | GET | ✅ | — | `unauthorized` (sin auth) | `forbidden` (cuenta desactivada) | — | — | `internal` | `service_unavailable` |
| `update-profile` | `/v1/users/me` | PATCH | ✅ | `bad_request` (`validation.*`, `validation.empty_changes`) | `unauthorized` | `forbidden` (cuenta desactivada o cambio de propio role/active) | — | — | `internal` | `service_unavailable` |
| `change-password` | `/v1/users/me/password` | PUT | ✅ | `bad_request` (`validation.*`) | `unauthorized` | `forbidden` (cuenta desactivada) | — | — | `internal` | `service_unavailable` |
| `list-users` | `/v1/users` | GET | ✅ | `bad_request` (`validation.invalid_limit` / `invalid_active` / `invalid_role`) | `unauthorized` | `forbidden` (cuenta desactivada o role != admin) | — | — | `internal` | `service_unavailable` |
| `update-user` | `/v1/users/{userId}` | PATCH | ✅ | `bad_request` (`validation.*`, `validation.empty_changes`) | `unauthorized` | `forbidden` (cuenta desactivada, no-admin-no-self, cambio de propio role/active) | `not_found` (userId no existe) | — | `internal` | `service_unavailable` |
| `activate-user` | `/v1/users/{userId}/activate` | POST | ✅ | `bad_request` (missing `userId`) | `unauthorized` | `forbidden` (cuenta desactivada, no-admin) | `not_found` (userId no existe) | — | `internal` | `service_unavailable` |
| `deactivate-user` | `/v1/users/{userId}/deactivate` | POST | ✅ | `bad_request` (missing `userId`) | `unauthorized` | `forbidden` (cuenta desactivada, no-admin, self-deactivation) | `not_found` (userId no existe) | — | `internal` | `service_unavailable` |
| `audit` | `/v1/audit` | GET | - | `bad_request` (`validation.invalid_*` en filtros) | `unauthorized` | `forbidden` (`audit.admin_only` — role != admin) | - | - | `internal` | `service_unavailable` (`db.*`) |
| `authorizer` (Lambda Authorizer, no HTTP) | — | — | — | — | API Gateway rechaza con 401 si `isAuthorized: false` | — | — | — | — | — |
| `migrate` (direct invoke, no HTTP) | — | — | ✅ | `bad_request` (`validation.*` en `direction`) | IAM `lambda:InvokeFunction` | — | — | — | `internal` | `service_unavailable` (`db.*`) |

---

## 5. Cdigos **no usados** actualmente

Reservados para uso futuro; no se emiten en respuestas hoy:

| Cdigo | HTTP | Planeado para |
|---|---|---|
| `unprocessable_entity` | 422 | Validaciones de negocio ms all de Zod (ej. reglas cross-field) |
| `too_many_requests` | 429 | Rate limiting (futuro) |

---

## 6. CORS errors (no son errores HTTP)

Las peticiones `OPTIONS` (preflight) **no** se enrutan al handler. El
middleware `inlineCorsMiddleware()` en
[`build-handler.ts:84`](../shared/src/templates/build-handler.ts) las
intercepta y responde `204 No Content` con headers CORS.

Si el `Origin` del cliente no est en la allow-list (futuro WAF) **no**
se intercepta aqu — la peticin sigue al handler y se rechaza con 403.
Esto aplica solo si en el futuro se cambia
`Access-Control-Allow-Origin: '*'` (actualmente `*`, ver
[auth-rbac.md § 5](./auth-rbac.md)).

---

## 7. Patrones para clientes

**TypeScript (SDK interno)**:

```ts
const result = await api.post('/v1/auth/login', { email, password });
if (!result.success) {
  switch (result.error.code) {
    case 'unauthorized':  /* creds invlidas */ break;
    case 'forbidden':     /* cuenta desactivada */ break;
    case 'service_unavailable':
      const detail = result.error.details[0];
      if (detail.code === 'aws.unavailable') { /* retry */ }
      break;
  }
}
```

**Dispatch sobre detail codes**:

```ts
const detailCode = result.error.details[0]?.code;
if (detailCode === 'validation.invalid_format') {
  // Zod detected an invalid email/uuid/url
} else if (detailCode === 'user.email_taken') {
  // 409: email ya registrado
}
```

---

## 8. Side effects (audit log) en errores

Una pregunta frecuente: "cuando un endpoint devuelve 4xx o 5xx,
se escribe una fila en `identity.audit_log`?"

**Respuesta corta**: NO. Solo las operaciones **exitosas** escriben audit row.

| HTTP status | Audit row? | Por qu |
|---|---|---|
| `2xx` (success) | **S** | El service layer envuelve la mutacin + `audit_log.insert` en una sola `db.transaction()` (Patrn ADR-015). |
| `4xx` (client error) | **No** | El handler aborta antes de invocar `UserService`. Ni siquiera se abre transaccin. |
| `5xx` (server error) | **No** | La transaccin se rollback, lo que incluye el `audit_log.insert` (atomicidad). |

**Caso especial — login fallido**: aunque devuelve `401`, el service
layer aborta antes de `withTransaction(...)` (no hay mutacin de
`users` para envolver). Ver [auth-rbac.md § 1.1](./auth-rbac.md) para
ms detalle sobre por qu no escribir `user.login` en failure.

**Caso especial — idempotencia**: si una operacin idempotente (ej.
`updateUser` con el mismo valor) retorna `200` pero **no** cambia
ninguna fila, **no** se escribe audit row. Ver ADR-015 § "Decisin".

---

## 9. Referencias cruzadas

- [`shared/src/http/api-error.ts`](../shared/src/http/api-error.ts) — clase `ApiError` y factories.
- [`shared/src/http/error-detail.ts`](../shared/src/http/error-detail.ts) — `ErrorDetail` interface.
- [`shared/src/http/api-response.ts`](../shared/src/http/api-response.ts) — `formatError()`, `formatResponse()`.
- [auth-rbac.md](./auth-rbac.md) — RBAC matrix (relacionado con 401/403).
- [use-cases.md](./use-cases.md) — para qu handler devuelve qu status.