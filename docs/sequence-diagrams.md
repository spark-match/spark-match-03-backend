# Sequence Diagrams — Spark Match Backend (Identity context)

> Diagramas ASCII de los flujos clave del contexto Identity. Cada
> diagrama muestra actores, componentes y el camino de los datos.
>
> Para descripcin detallada de cada caso de uso ver [use-cases.md](./use-cases.md).
> Para RBAC/auth ver [auth-rbac.md](./auth-rbac.md). Para eventos ver
> [event-catalog.md](./event-catalog.md).

Last reviewed: 2026-07-28.

Convenciones:

- `→` request / emit
- `⇽` response / subscribe
- `---` tiempo
- `(...)` condicin / branch
- `[x]` componente externo

---

## 1. Registro de usuario (`POST /v1/auth/register`)

```
 Client            HTTP API         register.ts        userService         UserRepo          EventBridge          identity.users
  │                  │                  │                  │                  │                    │                    │
  │  POST /register  │                  │                  │                  │                    │                    │
  │  {email,pass,...}│                  │                  │                  │                    │                    │
  ├─────────────────▶│                  │                  │                  │                    │                    │
  │                  │  invoke          │                  │                  │                    │                    │
  │                  ├─────────────────▶│                  │                  │                    │                    │
  │                  │                  │  register()      │                  │                    │                    │
  │                  │                  ├─────────────────▶│                  │                    │                    │
  │                  │                  │                  │  existsByEmail() │                    │                    │
  │                  │                  │                  ├─────────────────▶│                    │                    │
  │                  │                  │                  │                  │  SELECT WHERE email │                    │
  │                  │                  │                  │                  ├─────────────────────────────────────────▶│
  │                  │                  │                  │                  │  ⇽ row | null                          │
  │                  │                  │                  │  ⇽ false         │                    │                    │
  │                  │                  │  (if exists)     │                  │                    │                    │
  │                  │                  │  throw 409       │                  │                    │                    │
  │                  │                  │  user.email_taken│                  │                    │                    │
  │                  │                  │                  │  hashPassword()  │                    │                    │
  │                  │                  │                  │  scrypt(pwd)     │                    │                    │
  │                  │                  │                  │  ~100ms          │                    │                    │
  │                  │                  │                  │  create({...})   │                    │                    │
  │                  │                  │                  ├─────────────────▶│                    │                    │
  │                  │                  │                  │                  │  INSERT INTO users  │                    │
  │                  │                  │                  │                  ├─────────────────────────────────────────▶│
  │                  │                  │                  │                  │  ⇽ User (id, role=admin, active=true)     │
  │                  │                  │                  │  ⇽ User          │                    │                    │
  │                  │                  │  (UserRegistered event)             │                    │                    │
  │                  │                  │                  │  makeDomainEvent │                    │                    │
  │                  │                  │                  ├───────────────── │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶│                    │
  │                  │                  │                  │  publish()       │                    │ PutEvents(UserReg.) │
  │                  │                  │                  │                  │                    │ → bus spark-match   │
  │                  │                  │  ⇽ User          │                  │                    │                    │
  │                  │  ⇽ 200 {id,email,│                  │                  │                    │                    │
  │                  │   fullName,      │                  │                  │                    │                    │
  │                  │   createdAt}     │                  │                  │                    │                    │
  │  ⇽ JSON          │                  │                  │                  │                    │                    │
```

**Puntos de falla**:
- 409 si email ya existe (`user.email_taken`).
- 503 si DB falla (`db.unavailable`) o EventBridge falla
  (`aws.unavailable`). **El evento se publica despus del INSERT** — si
  EventBridge falla, la fila en DB queda creada sin notificar a
  consumidores. Esto es **at-most-once** por diseo (ver ADR-013 si
  existe; si no, tracked backlog).

---

## 2. Login + JWT (`POST /v1/auth/login`)

```
 Client         HTTP API        login.ts       userService      UserRepo       SecretsMgr    jose (signJwt)
  │               │               │                │              │                │              │
  │ POST /login   │               │                │              │                │              │
  │ {email,pass}  │               │                │              │                │              │
  ├──────────────▶│               │                │              │                │              │
  │               │  invoke       │                │              │                │              │
  │               ├──────────────▶│                │              │                │              │
  │               │               │ authenticate() │              │                │              │
  │               │               ├───────────────▶│              │                │              │
  │               │               │                │ findByEmail()│                │              │
  │               │               │                ├─────────────▶│                │              │
  │               │               │                │              │ SELECT WHERE   │              │
  │               │               │                │              │  email=$1      │              │
  │               │               │                │              ├───────────────▶│              │
  │               │               │                │              │ ⇽ User|null    │              │
  │               │               │                │ (if null)    │                │              │
  │               │               │                │ throw 401    │                │              │
  │               │               │                │ invalidCreds │                │              │
  │               │               │                │ (if !active) │                │              │
  │               │               │                │ throw 403    │                │              │
  │               │               │                │ deactivated  │                │              │
  │               │               │                │ verifyPassword()              │              │
  │               │               │                │  scrypt.compare              │              │
  │               │               │                │  ~100ms       │                │              │
  │               │               │                │ (if mismatch)│                │              │
  │               │               │                │ throw 401    │                │              │
  │               │               │                │  (UserLoggedIn event)         │              │
  │               │               │                │ makeDomainEvent ─ ─ ─ ─ ─ ─ ─ ─ ─ ▶│    │
  │               │               │                │ publish()    │                │   PutEvents  │
  │               │               │                │ ⇽ User        │                │              │
  │               │               │ signForUser()  │              │                │              │
  │               │               ├────────────────────────────────────────────────▶ loadJwtSecret│
  │               │               │                │              │                │ GetSecret    │
  │               │               │                │              │                │ Value        │
  │               │               │                │              │                │ ⇽ secret     │
  │               │               │                │              │                │ (cached)     │
  │               │               │                │              │                │              │
  │               │               │                │              │                │              │ signJwt()
  │               │               │                │              │                │              │ HS256
  │               │               │                │              │                │              │ ⇽ JWT
  │               │               │ ⇽ LoginResp    │              │                │              │
  │               │ ⇽ 200 {access │                │              │                │              │
  │               │  Token, expIn │                │              │                │              │
  │               │  :86400, user}│                │              │                │              │
  │ ⇽ JSON        │               │                │              │                │              │
```

**Puntos de falla**:
- 401 (credenciales invlidas) — mensaje genrico; no distingue email-no-existe vs password-mismatch.
- 403 (cuenta desactivada).
- 503 (`aws.unavailable` si Secrets Manager falla, `db.unavailable` si DB falla).

---

## 3. Cambio de password (`PUT /v1/users/me/password`)

```
 Client        API GW     Authorizer     change-password.ts   userService    UserRepo       EventBridge
  │              │            │                  │                 │            │               │
  │ Bearer JWT   │            │                  │                 │            │               │
  │              │  invoke    │                  │                 │            │               │
  │              ├───────────▶│                  │                 │            │               │
  │              │  (only if  │                  │                 │            │               │
  │              │  route has │ verifyJwt()      │                 │            │               │
  │              │  Authorizer) loadJwtSecret    │                 │            │               │
  │              │            │  + jose.verify   │                 │            │               │
  │              │  ⇽ isAuth  │  return ctx      │                 │            │               │
  │              │  + context │  {userId,email,  │                 │            │               │
  │              │            │   role}          │                 │            │               │
  │              │  (route    │                  │                 │            │               │
  │              │  no Authorizer ──────────────▶│                 │            │               │
  │              │  → direct  │                  │ requireAuth()   │            │               │
  │              │  invoke)   │                  │  (fallback path)│            │               │
  │              │            │                  │  - if Authorizer│            │               │
  │              │            │                  │    ctx: trust it │            │               │
  │              │            │                  │  - else: parse  │            │               │
  │              │            │                  │    Authorization│            │               │
  │              │            │                  │    Bearer +     │            │               │
  │              │            │                  │    verifyJwt    │            │               │
  │ PUT /me/pwd  │            │                  │                 │            │               │
  │ {newPassword}│            │                  │                 │            │               │
  ├─────────────▶│            │                  │                 │            │               │
  │              │  invoke    │                  │                 │            │               │
  │              ├───────────────────────────────▶│                 │            │               │
  │              │            │                  │  ⇽ AuthContext  │            │               │
  │              │            │                  │ changePassword({actor, target, newPwd})
  │              │            │                  ├────────────────▶│            │               │
  │              │            │                  │                 │ loadActor()│               │
  │              │            │                  │                 │ findById() │               │
  │              │            │                  │                 ├───────────▶│               │
  │              │            │                  │                 │  ⇽ User    │               │
  │              │            │                  │                 │ (if !active)               │
  │              │            │                  │                 │ throw 403  │               │
  │              │            │                  │                 │ deactivated│               │
  │              │            │                  │                 │ loadAuthorizedTarget()     │
  │              │            │                  │                 │  (self allowed)           │
  │              │            │                  │                 │ hashPassword(newPwd)       │
  │              │            │                  │                 │  scrypt  ~100ms            │
  │              │            │                  │                 │ updatePassword(id, hash)   │
  │              │            │                  │                 ├───────────▶│               │
  │              │            │                  │                 │ UPDATE users SET pwd_hash  │
  │              │            │                  │                 │  ⇽ User    │               │
  │              │            │                  │                 │ (UserPasswordChanged event)│
  │              │            │                  │                 │ makeDomainEvent ─ ─ ─ ─ ─ ▶│
  │              │            │                  │                 │ publish()                 │ PutEvents
  │              │            │                  │  ⇽ {message}    │            │               │
  │              │ ⇽ 200      │                  │                 │            │               │
  │ ⇽ JSON       │            │                  │                 │            │               │
```

**Notas**:
- Solo `PATCH /v1/users/me` est wireado al Authorizer en
  `template.yaml`. `PUT /v1/users/me/password` corre Authorizer solo si
  se aade la lnea `Auth.Authorizer: !Ref IdentityAuthorizer` al route
  (gap conocido, Sprint 3).
- El Authorizer corre para TODAS las requests de la ruta, no solo la
  primera. TTL=0.
- **JWT actual sigue vlido** despus del cambio. El usuario puede
  seguir usando el token viejo 24 h. No hay revocacin.

---

## 4. Listar usuarios con paginacin (`GET /v1/users?limit=N&cursor=X`)

```
 Client       API GW       list-users.ts    userService       UserRepo
  │             │               │                │               │
  │ Bearer JWT  │               │                │               │
  │ GET /users  │               │                │               │
  │ ?limit=20   │               │                │               │
  │ &cursor=X   │               │                │               │
  ├────────────▶│               │                │               │
  │             │  invoke       │                │               │
  │             ├──────────────▶│                │               │
  │             │               │ requireAuth()  │               │
  │             │               │  ⇽ AuthContext │               │
  │             │               │ parseFilters() │               │
  │             │               │  - limit: parseInt   (validate 1..100)
  │             │               │  - cursor: string    (opaque)
  │             │               │  - active:  "true|false|all"
  │             │               │  - role:    "admin"
  │             │               │ listUsers({actorUserId, filters})
  │             │               ├───────────────▶│               │
  │             │               │                │ loadActor(actorUserId)
  │             │               │                │  (findById + active check)
  │             │               │                │ (if !active)  │
  │             │               │                │ throw 403     │
  │             │               │                │ (if actor.role !== 'admin')
  │             │               │                │ throw 403     │
  │             │               │                │ admin required│
  │             │               │                │ list(filters) │
  │             │               │                ├──────────────▶│
  │             │               │                │               │ SELECT * FROM identity.users
  │             │               │                │               │  WHERE ...
  │             │               │                │               │  ORDER BY created_at ASC
  │             │               │                │               │  LIMIT N+1
  │             │               │                │               │  (or WHERE id > cursor ORDER BY id LIMIT N+1)
  │             │               │                │               │ ⇽ rows[N+1]
  │             │               │                │  ⇽ {users, nextCursor} (opaque)
  │             │               │  ⇽ ListUsersOutput (mapped to PublicUser)
  │             │ ⇽ 200        │                │               │
  │ ⇽ JSON      │               │                │               │
```

**Detalles del cursor**:
- `nextCursor` = base64-url del `id` del ltimo item devuelto (opaco al
  cliente).
- Si `nextCursor === null`, no hay ms resultados.
- Para paginar, pasar `?cursor=<nextCursor>` en la siguiente peticin.

---

## 5. Desactivar usuario (`POST /v1/users/{userId}/deactivate`)

```
 Client       API GW     deactivate-user.ts  userService     UserRepo     EventBridge
  │             │               │                │              │              │
  │ Bearer JWT  │               │                │              │              │
  │ POST /users │               │                │              │              │
  │  /UUID/     │               │                │              │              │
  │  deactivate │               │                │              │              │
  ├────────────▶│               │                │              │              │
  │             │  invoke       │                │              │              │
  │             ├──────────────▶│                │              │              │
  │             │               │ requireAuth()  │              │              │
  │             │               │ deactivateUser({actor, target})
  │             │               ├───────────────▶│              │              │
  │             │               │                │ loadActor(actor)             │
  │             │               │                │  (if actor.id === target.id)  │
  │             │               │                │ throw 403 self-deactivation  │
  │             │               │                │ loadAuthorizedTarget(actor, target)
  │             │               │                │  (self OR admin)             │
  │             │               │                │  (if !target) throw 404      │
  │             │               │                │ (if target.active === false) │
  │             │               │                │  return target  (no-op, no event)
  │             │               │                │ setActive(target.id, false)  │
  │             │               │                ├─────────────▶│              │
  │             │               │                │              │ UPDATE users │
  │             │               │                │              │  SET active=false
  │             │               │                │              │ ⇽ User (active=false)
  │             │               │                │ (UserDeactivated event)       │
  │             │               │                │ makeDomainEvent ─ ─ ─ ─ ─ ─ ─▶│
  │             │               │                │ publish()    │              │ PutEvents
  │             │               │  ⇽ PublicUser  │              │              │
  │             │ ⇽ 200        │                │              │              │
  │ ⇽ JSON      │               │                │              │              │
```

**Idempotencia**: si el target ya estaba inactivo, **no** se ejecuta
el UPDATE ni se emite el evento. Response 200 con el `PublicUser`
actual.

---

## 6. Diagrama de Authorizer (separado del handler)

```
 Client       API Gateway      IdentityAuthorizer     SecretsMgr      identity.users
  │             │                    │                    │                │
  │ Bearer JWT  │                    │                    │                │
  │ → /v1/...   │  (route has Auth.Authorizer wired?)   │                │
  │             │  YES (1/8 today) ───▶│                  │                │
  │             │       invoke       │                  │                │
  │             │       POST /authorizer with event    │                │
  │             ├───────────────────▶│                  │                │
  │             │                    │ headers.authorization │             │
  │             │                    │ extract Bearer   │                │
  │             │                    │ loadJwtSecret()  │                │
  │             │                    ├──────────────────▶│                │
  │             │                    │  ⇽ secret        │                │
  │             │                    │ verifyJwt(token, secret)          │
  │             │                    │  HS256 verify    │                │
  │             │                    │  check iss/aud   │                │
  │             │                    │  check exp       │                │
  │             │                    │ (if invalid)     │                │
  │             │                    │  return deny()   │                │
  │             │  ⇽ {isAuthorized: │  {isAuthorized:  │                │
  │             │     false}        │    false}        │                │
  │             │  → 401 to client  │                  │                │
  │             │                    │ (if valid)       │                │
  │             │                    │ return allow({userId, email, role})
  │             │  ⇽ {isAuthorized: │  {isAuthorized:  │                │
  │             │     true,         │    true,         │                │
  │             │      context:{...}│     context:{...}}               │
  │             │  → invoke downstream handler with event.requestContext.authorizer.lambda={userId,email,role}
  │             │                    │                  │                │
  │             │  invoke downstream handler          │                │
  │             │   (with authorizer context)         │                │
```

**Detalle de timing**:
- Authorizer carga el secret JWT una vez por invocacin (cache local).
- Si el cache est stale, `loadJwtSecret()` consulta Secrets Manager
  (~50-150 ms warm, ~500 ms cold).
- `verifyJwt` con HS256 es ~0.1 ms por token.

---

## 7. Flujo de migracin (operacional, no HTTP)

```
 Dev/CI       AWS CLI       migrate Lambda      node-pg-migrate      Aurora
  │             │                │                    │                  │
  │ aws lambda invoke           │                    │                  │
  │   --function-name ...       │                    │                  │
  │   --payload '{"direction":  │                    │                  │
  │                "up"}'       │                    │                  │
  ├────────────▶│                │                    │                  │
  │             │  invoke        │                    │                  │
  │             ├───────────────▶│                    │                  │
  │             │                │ read MIGRATE_DATABASE_URL env         │
  │             │                │ parse direction    │                  │
  │             │                │ runner({databaseUrl, dir:'migrations',│
  │             │                │   migrationsTable:'spark_match_migrations'})
  │             │                ├───────────────────▶│                  │
  │             │                │                    │ getAppliedMigrations()         │
  │             │                │                    ├─────────────────▶│
  │             │                │                    │ ⇽ ['V001','V002']              │
  │             │                │                    │ applyPending()  │                  │
  │             │                │                    │ (for each missing V00N)         │
  │             │                │                    │ BEGIN                           │
  │             │                │                    ├─────────────────▶│
  │             │                │                    │ INSERT INTO public.spark_match_migrations (name) VALUES ('V003...')
  │             │                │                    │ ... execute V003 SQL body ...
  │             │                │                    │ COMMIT                          │
  │             │                │                    ├─────────────────▶│
  │             │                │                    │ ⇽ ok            │                  │
  │             │                │  ⇽ {direction:'up',applied:['V003'],log:[...]}
  │             │  ⇽ JSON        │                    │                  │
  │ ⇽ JSON      │                │                    │                  │
```

**Notas**:
- El Lambda **no** valida el SQL antes de aplicarlo — corre contra la
  DB real. Si la migracin tiene un bug, la DB puede quedar en estado
  inconsistente. Ver [runbook.md § 3](./runbook.md).
- Para staging/prod se recomienda ejecutar `direction: 'status'` antes
  de `up` para listar qu se va a aplicar.

---

## 8. Referencias

- [use-cases.md](./use-cases.md) — pre/post-condiciones por caso.
- [auth-rbac.md](./auth-rbac.md) — RBAC detallado + JWT TTL.
- [event-catalog.md](./event-catalog.md) — payloads de eventos.
- [data-model.md](./data-model.md) — schema de DB.
- [runtime-topology.md](./runtime-topology.md) — componentes.