# Auth & RBAC — Spark Match Backend

> Single source of truth para autenticacin, autorizacin, JWT lifecycle,
> y la matriz RBAC por endpoint.
>
> Para el contrato de envelope ver [error-catalog.md](./error-catalog.md).
> Para la lista de endpoints ver [api.md](./api.md).

Last reviewed: 2026-07-28.

---

## 1. Modelo de autenticacin

**Tipo**: JWT firmado con **HS256** (algoritmo simtrico) usando la
librera `jose@^6.2.4`.

| Componente | Detalle |
|---|---|
| Algoritmo | HS256 (HMAC-SHA-256) |
| Issuer (`iss`) | `spark-match-backend` |
| Audience (`aud`) | `spark-match-api` |
| Subject (`sub`) | User UUID (mismo que `identity.users.id`) |
| Claims custom | `email`, `role` |
| TTL | **86400 s (24 h)** — constante `DEFAULT_JWT_EXPIRES_SECONDS` en [`composition.ts:30`](../contexts/identity/src/composition.ts) |
| Refresh tokens | **No hay**. Re-login cada 24 h. |
| Revocacin | **No hay lista de revocados**. La expiracin es el nico mecanismo de invalidacin. |

**Secret**: cargado desde AWS Secrets Manager. ARN resuelto por SSM en
`/spark-match/secret/jwt-arn`. **Mnimo 32 bytes** requerido (HS256).

```ts
// composition.ts:28-30
const SSM_JWT_SECRET_ARN_KEY = '/spark-match/secret/jwt-arn';
const DEFAULT_JWT_EXPIRES_SECONDS = 86400;
```

**Qu handler firma el JWT**: solo `IdentityLoginFunction`. Cualquier otro
cambio de identidad (`change-password`) **no** re-firma ni rota el JWT.

### 1.1 TTL drift (importante)

| Archivo | Valor | Usado? |
|---|---|---|
| [`composition.ts:30`](../contexts/identity/src/composition.ts) | `86400` (24 h) | **S** — `signForUser` pasa este valor explcitamente |
| [`jwt-helpers.ts:33`](../shared/src/auth/jwt-helpers.ts) | `3600` (1 h, default) | **No** — nunca se invoca `signJwt()` sin `expiresInSeconds` |

El default de 1 h en `jwt-helpers.ts` est **muerto**. Si en el futuro un
nuevo caller invoca `signJwt()` sin pasar `expiresInSeconds`, recibir
1 h en lugar de 24 h. **Recomendacin**: alinear el default con
`DEFAULT_JWT_EXPIRES_SECONDS` o quitarlo.

---

## 2. Authorizer (HTTP API v2 REQUEST type)

`IdentityAuthorizerFunction` es un Lambda Authorizer HTTP API v2 (REQUEST
type) configurado en
[`contexts/identity/template.yaml:337-360`](../contexts/identity/template.yaml).

### 2.1 Contrato

**Input** (API Gateway → Authorizer):

```json
{
  "headers": { "authorization": "Bearer <jwt>" },
  "requestContext": { "path": "/v1/users/me" }
}
```

**Output** (Authorizer → API Gateway), Simple Response format:

```json
{
  "isAuthorized": true,
  "context": {
    "userId": "uuid",
    "email": "user@example.com",
    "role": "admin"
  }
}
```

Si el JWT es invlido, falta, o no tiene `sub`:

```json
{ "isAuthorized": false }
```

### 2.2 Qu rutas lo invocan

⚠️ **Inconsistencia conocida** — ver § 3.2.

```
PATCH /v1/users/me        → Auth.Authorizer: !Ref IdentityAuthorizer  ✅ wired
GET   /v1/users/me        → Authorizer: NONE                          ⚠️ middleware-only
PUT   /v1/users/me/password → Authorizer: NONE                          ⚠️ middleware-only
GET   /v1/users            → Authorizer: NONE                          ⚠️ middleware-only
PATCH /v1/users/{userId}   → Authorizer: NONE                          ⚠️ middleware-only
POST  /v1/users/{userId}/activate    → Authorizer: NONE               ⚠️ middleware-only
POST  /v1/users/{userId}/deactivate  → Authorizer: NONE               ⚠️ middleware-only
```

Solo 1 de 8 rutas protegidas est wired al Authorizer. El resto depende
del middleware `requireAuth` (defensa en profundidad).

### 2.3 TTL de la respuesta del Authorizer

`AuthorizerResultTtlInSeconds: 0` (configurado en
[`template.yaml:369`](../contexts/identity/template.yaml)). **Cero**
caching: cada peticin re-verifica el JWT. Tradeoff: ~5 ms warm latency
vs. cero riesgo de role stale tras cambio.

---

## 3. Matriz RBAC por endpoint

Tres tipos de actor:
- **anonymous**: sin Authorization header / JWT invlido.
- **self**: el `sub` del JWT coincide con el `userId` target.
- **admin**: JWT vlido con `role === 'admin'`.

Adicionalmente, la cuenta debe estar **`active = true`**. Si no, se
rechaza con `403` aunque el JWT sea vlido.

| Mtodo | Path | anonymous | self | admin | Notas |
|---|---|:---:|:---:|:---:|---|
| `POST` | `/v1/auth/register` | ✅ (crea cuenta nueva) | — | — | Si el email ya existe → 409 |
| `POST` | `/v1/auth/login` | ✅ | — | — | 401 si creds invlidas; 403 si cuenta desactivada |
| `GET` | `/v1/users/me` | 401 | ✅ | ✅ | self porque `sub === userId` |
| `PATCH` | `/v1/users/me` | 401 | ✅ (limitado) | ✅ | self: solo `fullName`, `age`. Admin: cualquier campo, ms role/active |
| `PUT` | `/v1/users/me/password` | 401 | ✅ | ✅ | |
| `GET` | `/v1/users` | 401 | 403 | ✅ | Admin-only (lista paginada de todos los users) |
| `PATCH` | `/v1/users/{userId}` | 401 | ✅ (limitado, si `sub === userId`) | ✅ (cualquier userId) | self: igual que `/me`. Admin: cambia cualquier user, incluido role/active |
| `POST` | `/v1/users/{userId}/activate` | 401 | 403 (no puedes activarte a ti mismo si ests desactivado, lock-out) | ✅ | Admin-only |
| `POST` | `/v1/users/{userId}/deactivate` | 401 | 403 (self-deactivation prohibida) | ✅ | Admin-only. Si el target ya est inactivo, no-op (idempotente, sin evento) |

**Detalles de "self limitado"**:

| Campo | self puede? | admin puede? |
|---|:---:|:---:|
| `fullName` | ✅ | ✅ |
| `age` | ✅ | ✅ |
| `role` | ❌ → 403 | ✅ |
| `active` | ❌ → 403 | ✅ |

### 3.1 Detalle por handler (origen de las reglas)

Las reglas viven en
[`user-service.ts`](../contexts/identity/src/service/user-service.ts):

| Regla | Cdigo | Lnea |
|---|---|---|
| `loadActor()` — verifica JWT y `active` | `user-service.ts:84-93` | |
| `loadAuthorizedTarget()` — self OR admin | `user-service.ts:101-112` | |
| `updateUser` self-rule: no puede cambiar `role` propio | `user-service.ts:201-208` | |
| `deactivateUser` self-rule: no puede desactivarse | `user-service.ts:243-245` | |
| `listUsers` admin-only | `user-service.ts:284-286` | |

### 3.2 ⚠️ Inconsistencia Authorizer

**Estado**: solo 1 de 8 rutas protegidas invoca `IdentityAuthorizer` en
API Gateway. Las otras dependen del middleware `requireAuth` en el
handler. **Esto funciona** (defense in depth) pero:

- El Authorizer Lambda corre 1/8 de las veces.
- En `sam local invoke` (sin API Gateway) **todas** las rutas dependen
  del middleware → hay que mockear el Authorizer context o el Bearer
  fallback (ver `requireAuth()` en
  [`shared/src/auth/require-auth.ts`](../shared/src/auth/require-auth.ts)).
- Tests E2E futuros requieren API Gateway real para validar el flujo
  completo.

**Plan (Sprint 3)**: wirear las 8 rutas restantes al Authorizer.
Deprecacin del middleware `requireAuth` para rutas protegidas. Ver
`RUNTIME-TOPOLOGY.md § 3.1`.

---

## 4. Defense in depth: `requireAuth` middleware

[`shared/src/auth/require-auth.ts`](../shared/src/auth/require-auth.ts)
implementa verificacin en **dos niveles**:

1. **Prefer Authorizer context** (`event.requestContext.authorizer.lambda`).
   Si el Authorizer corri, su contexto ya fue validado.
2. **Fallback Bearer**: si no hay Authorizer context (sam local, errores
   de configuracin), re-verifica el JWT del header `Authorization`.

```ts
// require-auth.ts:24-35
const ctx = event.requestContext?.authorizer?.lambda;
if (ctx?.userId && typeof ctx.userId === 'string') {
  return { userId: ctx.userId, email: ctx.email, role: ctx.role, ... };
}
// fallback: parse Authorization: Bearer <token>
```

El fallback **siempre** corre el `verifyJwt()` con `loadJwtSecret()` (SSM +
Secrets Manager). Por eso la mayora de los handlers declaran
`requireAuth: true` en su `buildHandler({...})` config.

### 4.1 Secret cache

`jwt-secret-loader.ts` cachea el secret JWT **por invocacin Lambda**
(memoization local). El SSM reader tiene TTL de **5 min** (ver
[`shared/src/infra/ssm-reader.ts`](../shared/src/infra/ssm-reader.ts)).
Combinado, una rotacin del secret tarda **hasta 5 min + 1 cold start**
en propagarse a todos los Lambdas.

---

## 5. CORS y `Access-Control-Allow-Origin: '*'`

`template.yaml:73-90` configura CORS con `AllowOrigins: '*'`. Esto es
**intencional para dev** pero **debe tightening antes de prod**:

- Dev: `*` (acepta cualquier origen).
- Prod: dominios especficos via custom domain + WAF rules.

**Header sent** en cada respuesta:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type, Authorization, X-Correlation-Id
Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
Access-Control-Expose-Headers: X-Correlation-Id
```

Preflight `OPTIONS` se responde **204** sin pasar al handler (ver
[`build-handler.ts:97-107`](../shared/src/templates/build-handler.ts)).

---

## 6. JWT secret rotation procedure

**Cundo**: anualmente (target, ver ADR). **Sin SLA actual**.

**Pasos**:

1. Crear nueva versin del secret en AWS Secrets Manager con un nuevo
   valor de **al menos 32 bytes** (ej. `openssl rand -base64 48`).
2. Marcar la versin anterior con `VersionStages: ['AWSCURRENT']` →
   `VersionStages: ['AWSPREVIOUS']` para la nueva (Secrets Manager hace
   esto automticamente al rotar).
3. Esperar hasta **5 min** (TTL del SSM cache) + prximo cold start
   para que todos los Lambdas carguen el nuevo secret.
4. Los JWTs firmados con el secret anterior **siguen siendo vlidos**
   hasta su `exp` (24 h). No hay invalidacin forzada.
5. **Opcional** (no soportado an): blacklist temporal por `sub` o por
   `jti`. Hoy no existe ese mecanismo.

**Drift potencial**: si se rota y los JWTs antiguos deben morir
rpidamente, hoy **no se puede**. Workaround: cambiar `iss` o `aud`
para invalidar todos los JWTs existentes.

---

## 7. Password storage

Algoritmo: **scrypt** con parmetros N=16384, r=8, p=1, keylen=64, salt=16
bytes (default Node `crypto.scrypt` excepto N).

**Formato en DB**: `scrypt$N$r$p$salt_b64u$hash_b64u`.

```ts
// shared/src/auth/hash-password.ts:38-45
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) throw new Error('Password must be at least 8 characters');
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(plain, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
```

**Por qu async**: la versin sync bloquea el event loop ~100 ms; bajo
carga esto amplifica el noisy-neighbor effect.

**Poltica de password** (validacin Zod):

| Regla | Rango |
|---|---|
| Mnimo | 8 chars |
| Mximo | 100 chars |
| Complejidad (uppercase, digit, symbol) | **No requerida** |

**No hay**: poltica de expiracin, password history, fuerza mnima con
zxcvbn. Tracking para futuro.

---

## 8. Secrets inventory

Todos los secretos / configuracin sensible vive en AWS Secrets Manager o
SSM Parameter Store. ARN expuesto al Lambda via env var.

| Env var | Resolucin | Propsito | Rotacin |
|---|---|---|---|
| `JWT_SECRET_ARN` | SSM `/spark-match/secret/jwt-arn` → Secrets Manager | HS256 signing key | Anual (target) |
| `DB_SECRET_ARN` | SSM `/spark-match/db/secret-arn` → Secrets Manager | Aurora master credentials | Secrets Manager rotation (Terraform) |
| `MIGRATE_DATABASE_URL` | SSM `/spark-match/db/connection-url` | URL completa para el migrator | Junto a `DB_SECRET_ARN` |
| `EVENT_BUS_ARN` | SSM `/spark-match/eventbridge/bus-arn` | Bus ARN para `PutEvents` | N/A (es un ARN) |
| `IDEMPOTENCY_TABLE_NAME` | SSM `/spark-match/dynamodb/idempotency-table` | DynamoDB table para idempotency (reservado, no usado) | N/A |

**IAM grants por Lambda**: ver [runtime-topology.md § 2.4](./runtime-topology.md).

---

## 9. Referencias cruzadas

- [runtime-topology.md § 3](./runtime-topology.md) — Authorizer wiring.
- [error-catalog.md § 4](./error-catalog.md) — matriz handler × HTTP status.
- [use-cases.md](./use-cases.md) — pre/post-condiciones por caso de uso.
- [api.md](./api.md) — contratos HTTP por ruta.