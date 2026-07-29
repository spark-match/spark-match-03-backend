# API Reference — Spark Match Backend

> HTTP API v2 reference. **Source of truth**: las schemas Zod en
> `contexts/identity/src/schemas/*.schema.ts`. Si este doc y el cdigo
> divergen, gana el cdigo.
>
> Para casos de uso y efectos colaterales ver [use-cases.md](./use-cases.md).
> Para errores y status codes ver [error-catalog.md](./error-catalog.md).
> Para RBAC ver [auth-rbac.md](./auth-rbac.md).

Last reviewed: 2026-07-28. **Base URL**: `https://<api-id>.execute-api.<region>.amazonaws.com/<environment>`. Output de SAM stack: `spark-match-${Environment}-HttpApiUrl`.

---

## 1. Convenciones

### 1.1 HTTP

- **Mtodo**: HTTP standard (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
- **Path prefix**: `/v1/`.
- **Auth header**: `Authorization: Bearer <jwt>` (excepto `/v1/auth/*`).
- **Content-Type**: `application/json` (request y response).
- **CORS**: `*` en dev; ver [auth-rbac.md § 5](./auth-rbac.md) para prod.

### 1.2 Response envelope (xito)

```json
{
  "success": true,
  "data": { /* payload */ },
  "meta": { "requestId": "uuid", "timestamp": "2026-..." }
}
```

### 1.3 Response envelope (error)

```json
{
  "success": false,
  "error": {
    "code": "validation",
    "message": "Human-readable",
    "details": [{ "code": "validation.invalid_type", "path": "email", "value": 42 }]
  },
  "meta": { "requestId": "uuid", "timestamp": "2026-..." }
}
```

Ver [error-catalog.md § 1](./error-catalog.md) para el contrato completo.

### 1.4 Dates

- Request: ISO-8601 string (`z.iso.datetime()`).
- Response: ISO-8601 string (`Date.toISOString()`).

---

## 2. Auth endpoints

### 2.1 `POST /v1/auth/register`

Crea una nueva cuenta. **No requiere auth**.

**Request body** ([`register.schema.ts`](../contexts/identity/src/schemas/register.schema.ts)):

```json
{
  "email": "user@example.com",
  "password": "min8chars",
  "fullName": "Ada Lovelace",
  "age": 36
}
```

| Campo | Tipo | Requerido | Validacin |
|---|---|:---:|---|
| `email` | string | ✅ | email RFC, max 200, lowercase |
| `password` | string | ✅ | min 8, max 100 |
| `fullName` | string | ✅ | min 2, max 200 |
| `age` | integer | no | 13..120 |

**Response 200**:

```json
{
  "success": true,
  "data": {
    "id": "uuid-v4",
    "email": "user@example.com",
    "fullName": "Ada Lovelace",
    "createdAt": "2026-07-28T12:00:00.000Z"
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

**Errores**: 400 (`validation.*`), 409 (`user.email_taken`), 500, 503.

Ver [use-cases.md UC-1](./use-cases.md).

### 2.2 `POST /v1/auth/login`

Autentica y devuelve JWT. **No requiere auth**.

**Request body** ([`login.schema.ts`](../contexts/identity/src/schemas/login.schema.ts)):

```json
{
  "email": "user@example.com",
  "password": "min8chars"
}
```

| Campo | Tipo | Requerido | Validacin |
|---|---|:---:|---|
| `email` | string | ✅ | email RFC, max 200, lowercase |
| `password` | string | ✅ | min 8, max 100 |

**Response 200**:

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 86400,
    "user": {
      "id": "uuid-v4",
      "email": "user@example.com",
      "fullName": "Ada Lovelace"
    }
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

**`expiresIn`**: siempre `86400` (24 h). Ver
[auth-rbac.md § 1](./auth-rbac.md).

**Errores**: 400, 401 (credenciales invlidas), 403 (cuenta desactivada), 503.

Ver [use-cases.md UC-2](./use-cases.md).

---

## 3. Self endpoints

Requieren `Authorization: Bearer <jwt>`. El `sub` del JWT se usa como
`userId` (self).

### 3.1 `GET /v1/users/me`

Devuelve el perfil del usuario autenticado.

**Auth**: requerida (middleware; Authorizer no wireado en template.yaml).
**Request body**: ninguno.

**Response 200** (PublicUser, sin `passwordHash`):

```json
{
  "success": true,
  "data": {
    "id": "uuid-v4",
    "email": "user@example.com",
    "fullName": "Ada Lovelace",
    "age": 36,
    "role": "admin",
    "active": true,
    "createdAt": "2026-07-28T12:00:00.000Z",
    "updatedAt": "2026-07-28T12:00:00.000Z"
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

**Errores**: 401, 403, 503.

Ver [use-cases.md UC-3](./use-cases.md).

### 3.2 `PATCH /v1/users/me`

Actualiza el perfil propio. **La nica ruta wireada al Authorizer en
template.yaml**.

**Auth**: requerida. **Es la nica ruta donde `IdentityAuthorizer` est
adjuntado al route** (defensa en profundidad via Authorizer + middleware).

**Request body** ([`update-profile.schema.ts`](../contexts/identity/src/schemas/update-profile.schema.ts)):

```json
{
  "fullName": "Ada L.",
  "age": 37
}
```

| Campo | Tipo | Requerido | Validacin |
|---|---|:---:|---|
| `fullName` | string | no | min 2, max 200 |
| `age` | integer \| null | no | 13..120 |

**Restricciones self** (ver [auth-rbac.md § 3](./auth-rbac.md)):

- `role` y `active` **no se aceptan** en el body (rechazo 403 si se envan).
- Body **no** puede estar vaco (`validation.empty_changes` → 400).

**Response 200**: `PublicUser` (mismo shape que `GET /me`).

**Errores**: 400 (`validation.*`, `validation.empty_changes`), 401, 403
(intento de cambiar role/active propio), 503.

Ver [use-cases.md UC-4](./use-cases.md).

### 3.3 `PUT /v1/users/me/password`

Cambia el password del usuario autenticado.

**Auth**: requerida (middleware).

**Request body** ([`change-password.schema.ts`](../contexts/identity/src/schemas/change-password.schema.ts)):

```json
{ "newPassword": "newMin8chars" }
```

| Campo | Tipo | Requerido | Validacin |
|---|---|:---:|---|
| `newPassword` | string | ✅ | min 8, max 100 |

**Response 200**:

```json
{
  "success": true,
  "data": { "message": "password updated" },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

**Nota**: el JWT actual **sigue siendo vlido** despus del cambio (TTL
24 h). No hay revocacin. Ver [auth-rbac.md § 1](./auth-rbac.md).

**Errores**: 400, 401, 403, 503.

Ver [use-cases.md UC-6](./use-cases.md).

---

## 4. Admin endpoints

Requieren `Authorization: Bearer <jwt>` con `role === 'admin'`. Usan
`requireAuth` middleware + verificacin de role en `user-service.ts`.

### 4.1 `GET /v1/users`

Lista paginada de todos los usuarios. **Admin only**.

**Auth**: requerida (middleware). Role check: admin-only en service layer.

**Query params**:

| Param | Tipo | Default | Rango | Notas |
|---|---|---|---|---|
| `limit` | integer | `20` | 1..100 | Tamao de pgina |
| `cursor` | string | — | opaque (base64 de userId) | Cursor de paginacin |
| `active` | enum | — | `true` \| `false` \| `all` | Filtrar por estado |
| `role` | enum | — | `admin` (nico hoy) | Filtrar por role |

**Errores de validacin**:

| Param fuera de rango | Detail code |
|---|---|
| `limit` no entero o fuera de [1, 100] | `validation.invalid_limit` |
| `active` no es `true`/`false`/`all` | `validation.invalid_active` |
| `role` no en `USER_ROLES` | `validation.invalid_role` |

**Response 200**:

```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "uuid-v4",
        "email": "user@example.com",
        "fullName": "Ada Lovelace",
        "age": 36,
        "role": "admin",
        "active": true,
        "createdAt": "2026-07-28T12:00:00.000Z",
        "updatedAt": "2026-07-28T12:00:00.000Z"
      }
    ],
    "nextCursor": "uuid-v4-or-null"
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

**`nextCursor`**: `null` si no hay ms resultados. Para paginar, pasar
`?cursor=<nextCursor>` en la siguiente peticin.

**Errores**: 400, 401, 403, 503.

Ver [use-cases.md UC-7](./use-cases.md).

### 4.2 `PATCH /v1/users/{userId}`

Actualiza un usuario arbitrario. **Admin only** (o self con campos
limitados).

**Auth**: requerida (middleware).

**Path params**:

| Param | Tipo | Notas |
|---|---|---|
| `userId` | UUID | userId target |

**Request body**: mismo que `PATCH /me` (re-usa `UpdateProfileInputSchema`):

```json
{
  "fullName": "Ada L.",
  "age": 37,
  "role": "admin",
  "active": false
}
```

| Campo | Tipo | Requerido | Restriccin self | Restriccin admin |
|---|---|:---:|---|---|
| `fullName` | string | no | ✅ | ✅ |
| `age` | integer \| null | no | ✅ | ✅ |
| `role` | string | no | ❌ → 403 | ✅ |
| `active` | boolean | no | ❌ → 403 | ✅ |

Body **no** puede estar vaco.

**Response 200**: `PublicUser`.

**Errores**: 400, 401, 403 (cuenta desactivada, no-admin-no-self, intento
de cambiar propio role/active), 404 (userId no existe), 503.

Ver [use-cases.md UC-5](./use-cases.md).

### 4.3 `POST /v1/users/{userId}/activate`

Activa un usuario desactivado. **Admin only**.

**Auth**: requerida (middleware).

**Path params**:

| Param | Tipo | Notas |
|---|---|---|
| `userId` | UUID | userId target |

**Request body**: ninguno.

**Response 200**: `PublicUser`.

**Idempotencia**: si el target ya estaba `active = true`, devuelve 200
con el `PublicUser` actual **sin** emitir evento.

**Errores**: 400 (userId faltante en path), 401, 403, 404, 503.

Ver [use-cases.md UC-8](./use-cases.md).

### 4.4 `POST /v1/users/{userId}/deactivate`

Desactiva un usuario activo. **Admin only**. **Self-deactivation prohibida**.

**Auth**: requerida (middleware).

**Path params**:

| Param | Tipo | Notas |
|---|---|---|
| `userId` | UUID | userId target (≠ auth.userId) |

**Request body**: ninguno.

**Response 200**: `PublicUser`.

**Idempotencia**: si el target ya estaba `active = false`, devuelve 200
con el `PublicUser` actual **sin** emitir evento.

**Errores**: 400 (userId faltante), 401, 403 (cuenta desactivada, no-admin,
o self-deactivation), 404, 503.

Ver [use-cases.md UC-9](./use-cases.md).

---

## 5. Tipos compartidos

### 5.1 `PublicUser`

Shape retornado por GET/PATCH en cualquier ruta de usuario. **Nunca**
incluye `passwordHash`.

```ts
interface PublicUser {
  id: string;            // UUID
  email: string;
  fullName: string;
  age: number | null;
  role: string;          // "admin" hoy, ver [auth-rbac.md](./auth-rbac.md)
  active: boolean;
  createdAt: string;     // ISO-8601
  updatedAt: string;     // ISO-8601
}
```

### 5.2 `LoginResponse`

```ts
interface LoginResponse {
  accessToken: string;   // JWT HS256
  expiresIn: number;     // Siempre 86400
  user: {
    id: string;
    email: string;
    fullName: string;
  };
}
```

### 5.3 `ErrorEnvelope`

Ver [error-catalog.md § 1](./error-catalog.md).

### 5.4 Codificacin de cursors

El cursor es un **base64-url del `userId`** del ltimo item devuelto. No
es transparente al cliente; no parsearlo. Si se necesita migrar el formato
del cursor en el futuro, versionarlo (`?cursor=v2:...`).

---

## 6. Endpoints NO documentados aqu

| Endpoint | Razon |
|---|---|
| Lambda Authorizer | Invocado por API Gateway, no accesible directamente |
| `migrate` Lambda | No HTTP. Ver [runbook.md](./runbook.md). |

---

## 7. Versionado de la API

- **Hoy**: pre-1.0. La ruta usa `/v1/` reservado para el primer contrato
  estable. Cambios incompatibles bump a `/v2/`.
- **No hay** OpenAPI/JSON Schema artifact generado (pendiente — ver
  ADR-013). Mientras tanto, este doc + los Zod schemas en cdigo son la
  source of truth.

---

## 8. CORS

Todas las rutas incluyen headers CORS (ver [auth-rbac.md § 5](./auth-rbac.md)).
Preflight `OPTIONS` se responde **204** sin pasar al handler.

---

## 9. Referencias

- [`shared/src/http/api-response.ts`](../shared/src/http/api-response.ts) — envelope implementation.
- [`shared/src/http/api-error.ts`](../shared/src/http/api-error.ts) — error code factory.
- [`contexts/identity/src/schemas/*.schema.ts`](../contexts/identity/src/schemas/) — Zod source of truth.
- [runtime-topology.md § 1](./runtime-topology.md) — route inventory cross-ref.