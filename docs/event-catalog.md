# Catálogo de Eventos de Dominio

> Single source of truth para los eventos que cruzan contextos. **Status quo**
> seccin § 2.4: la lista de eventos publicados por el cdigo Identity.
> Las secciones § 2.5–§ 2.11 documentan eventos **planificados** para futuros
> contextos (Assessment, Career, Matching, AI Advisor). **No estn en cdigo an**.

Last reviewed: 2026-07-28. Bus version: **v1**.

---

## 1. Convenciones

### 1.1 Naming

| Tipo | Convencin | Ejemplo |
|---|---|---|
| Domain Event | PascalCase, pasado | `UserRegistered` |
| Command (interno) | PascalCase, imperativo | `RegisterUser` |
| Integration Event | Prefijo `Integration` | `IntegrationCareerUpdated` |

### 1.2 Envelope en el bus (lo que produce `EventBridge`)

EventBridge aade automticamente los campos top-level al entregar:

```json
{
  "version": "0",
  "id": "uuid-v4",
  "detail-type": "UserRegistered",
  "source": "spark-match.identity",
  "account": "681526276858",
  "time": "2026-06-30T12:34:56.789Z",
  "region": "us-east-1",
  "resources": [],
  "detail": "{...JSON string...}"
}
```

`detail` viaja como **string JSON** dentro del envelope de EventBridge. Lo
deserializa el consumidor. `version: "0"` es la versin del envelope propio de
EventBridge (no la del payload).

### 1.3 Envelope del payload (lo que produce el servicio)

El servicio serializa a `detail` el siguiente sobre (`EventDetail<T>` en
`shared/src/events/types.ts`):

```json
{
  "version": 1,
  "data": {
    "schemaVersion": "1.0",
    "occurredAt": "2026-07-28T12:34:56.789Z",
    /* campos especficos del evento */
  }
}
```

| Campo | Tipo | Significado |
|---|---|---|
| `detail.version` | `number` (entero, empieza en 1) | Versin del schema del payload. **Lo fija `makeDomainEvent()`**, no el Zod schema. |
| `detail.data.schemaVersion` | `string` literal (ej. `"1.0"`) | Reservado para versioning futuro del payload (Zod schema). **Hoy todos los eventos son `"1.0"`.** |
| `detail.data.occurredAt` | ISO-8601 string | Timestamp del publicador. |

**Por qu dos versiones?** `detail.version` es la versin del envelope
(compartida por todos los eventos); `data.schemaVersion` es la versin del
schema del payload (puede evolucionar independientemente). Mantener los dos
permite bumpear el payload sin tocar el envelope y viceversa.

### 1.4 Versionado de payloads

- **Backward compatible** (aadir campo opcional) → mismo `schemaVersion`, sin breaking change.
- **Breaking change** (renombrar/quitar/cambiar tipo) → bump `schemaVersion` + crear nueva entrada en este catlogo.
- Consumidores deben ignorar campos desconocidos (tolerancia).

### 1.5 Source naming

`spark-match.<context>`:

| Source | Contexto | Status |
|---|---|---|
| `spark-match.identity` | Identity | **live** |
| `spark-match.assessment` | Assessment | planned |
| `spark-match.career` | Career | planned |
| `spark-match.matching` | Matching | planned |
| `spark-match.ai` | AI Advisor | planned (different repo) |

---

## 2. Eventos v1 — Identity context (live)

**Source**: `spark-match.identity`. **Detail-type**: PascalCase pasado.

Los payloads siguientes reflejan el **Zod schema** en
[`contexts/identity/src/domain/events.ts`](../contexts/identity/src/domain/events.ts)
y los `UserRegisteredEvent`, `UserLoggedInEvent`, etc. que se construyen en
[`contexts/identity/src/service/user-service.ts`](../contexts/identity/src/service/user-service.ts).

### 2.1 UserRegistered

**Producido por**: [`IdentityRegisterFunction`](./runtime-topology.md) →
`userService.register()`.  
**Trigger**: `POST /v1/auth/register` exitoso.

```json
{
  "schemaVersion": "1.0",
  "occurredAt": "2026-07-28T12:00:00.000Z",
  "userId": "uuid-v4",
  "email": "user@example.com",
  "fullName": "Ada Lovelace"
}
```

**Notas**:
- El email va **lowercase** (aplicacin lo normaliza antes de insert).
- No incluye `passwordHash`, `age` ni `role` (datos sensibles / no relevantes
  al consumidor tpico).

### 2.2 UserLoggedIn

**Producido por**: `IdentityLoginFunction` → `userService.authenticate()`.  
**Trigger**: `POST /v1/auth/login` exitoso (credenciales vlidas + cuenta
`active = true`).

```json
{
  "schemaVersion": "1.0",
  "occurredAt": "2026-07-28T12:00:00.000Z",
  "userId": "uuid-v4",
  "email": "user@example.com"
}
```

**Notas**:
- **No se emite** en login fallido (ni 401 ni 403). El servicio solo
  publica cuando la autenticacin es completa.

### 2.3 UserPasswordChanged

**Producido por**: `IdentityChangePasswordFunction` →
`userService.changePassword()`.  
**Trigger**: `PUT /v1/users/me/password` exitoso (cualquier actor vlido,
incluido admin actuando sobre s mismo).

```json
{
  "schemaVersion": "1.0",
  "occurredAt": "2026-07-28T12:00:00.000Z",
  "userId": "uuid-v4"
}
```

**Notas**:
- No incluye el hash (evidentemente).
- No incluye `actorUserId` (siempre es el propio target por diseo del
  handler actual; revisar cuando se permita cambio de password a otro).

### 2.4 UserUpdated

**Producido por**: `IdentityUpdateProfileFunction` y
`IdentityUpdateUserFunction` → `userService.updateUser()`.  
**Trigger**: `PATCH /v1/users/me` o `PATCH /v1/users/{userId}` con cambios
efectivos.

```json
{
  "schemaVersion": "1.0",
  "occurredAt": "2026-07-28T12:00:00.000Z",
  "userId": "uuid-v4",
  "changes": {
    "fullName": "Ada L.",
    "age": 36
  }
}
```

**Notas**:
- `changes` es un `Record<string, unknown>` con **solo los campos que el
  caller incluy**. No contiene los campos no enviados. No hay whitelist de
  claves hoy → cualquier clave presente en el input se propaga.
- **Adems**, si el admin cambi `role`, se emite `UserRoleChanged` (ver § 2.7).
  Esos dos eventos (`UserUpdated` + `UserRoleChanged`) salen en la misma
  peticin, ambos a `EventBridge`.

### 2.5 UserActivated

**Producido por**: `IdentityActivateUserFunction` →
`userService.activateUser()`.  
**Trigger**: `POST /v1/users/{userId}/activate` cuando el target estaba
inactivo.

**Idempotencia**: si el target ya estaba `active = true`, el servicio
retorna sin escribir DB y **sin emitir** el evento.

```json
{
  "schemaVersion": "1.0",
  "occurredAt": "2026-07-28T12:00:00.000Z",
  "userId": "uuid-v4"
}
```

### 2.6 UserDeactivated

**Producido por**: `IdentityDeactivateUserFunction` →
`userService.deactivateUser()`.  
**Trigger**: `POST /v1/users/{userId}/activate` cuando el target estaba
activo y **el actor no es el propio target** (self-deactivation prohibida).

**Idempotencia**: si el target ya estaba `active = false`, el servicio
retorna sin escribir DB y **sin emitir** el evento.

```json
{
  "schemaVersion": "1.0",
  "occurredAt": "2026-07-28T12:00:00.000Z",
  "userId": "uuid-v4"
}
```

### 2.7 UserRoleChanged

**Producido por**: `IdentityUpdateUserFunction` →
`userService.updateUser()` (slo cuando `changes.role` produce una
transicin efectiva, y el actor es **admin no-actuando-sobre-s-mismo**).

```json
{
  "schemaVersion": "1.0",
  "occurredAt": "2026-07-28T12:00:00.000Z",
  "userId": "uuid-v4",
  "fromRole": "admin",
  "toRole": "admin"
}
```

**Notas**:
- Hoy `USER_ROLES = ['admin']` (single-valued). El branch de emisin es
  alcanzable en cdigo pero el `fromRole` y `toRole` siempre sern `"admin"`
  hasta que se aadan roles adicionales. Tests
  (`tests/user-service.test.ts`) lo documentan explcitamente.
- Sale **junto con** `UserUpdated` en la misma peticin (no son eventos
  alternativos).

---

## 3. Side effects (audit_log) — dual write

Cada operacin que emite un EventBridge event **tambin** escribe una fila
en `identity.audit_log` (Patrn ADR-015). Los dos mecanismos son
**complementarios**, no duplicados:

| | `audit_log` (DB) | EventBridge (bus) |
|---|---|---|
| **Durabilidad** | Fuerte (PG, transactional) | Best-effort (at-least-once) |
| **Latencia** | ~3ms (sync en la tx) | ~5-10ms (async post-commit) |
| **Consumidores** | Solo admin tool (futuro `GET /v1/audit`) | Assessment, Career, Matching, Notifications, AI Advisor |
| **Forma** | `action`, `subject_user_id`, `metadata` | `detail.data.schemaVersion`, `detail.data.occurredAt`, payload |
| **Si falla** | Rollback de la mutacin de `users` (atmica) | Solo log warn; no afecta la mutacin |

**Mapping** (action → event):

| `audit_log.action` | EventBridge event |
|---|---|
| `user.registered` | `UserRegistered` |
| `user.login` | `UserLoggedIn` |
| `user.profile_viewed` | (ninguno — read-only) |
| `user.profile_updated` | `UserUpdated` |
| `user.password_changed` | `UserPasswordChanged` |
| `user.activated` | `UserActivated` |
| `user.deactivated` | `UserDeactivated` |
| `user.role_changed` | (envelope-level `roleChanged=true` flag en `UserUpdated`) |
| `user.list_viewed` | (ninguno — read-only) |

**Nota operacional**: el `audit_log` es la **nica fuente de verdad**
forense (compliance / GDPR Art. 30). Los EventBridge events son para
fan-out a bounded contexts downstream, pero **no** se debe confiar en
ellos para auditora (pueden perderse si EventBridge falla).

---

## 4. Matriz productor ↔ consumidor

| Evento | Identity (P) | Assessment | Career | Matching | AI Advisor | Notifications |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `UserRegistered` | 🟢 | | | | 🔵 | 🔵 |
| `UserLoggedIn` | 🟢 | | | | 🔵 | |
| `UserPasswordChanged` | 🟢 | | | | | |
| `UserUpdated` | 🟢 | | | 🔵 | 🔵 | |
| `UserActivated` | 🟢 | | | | | 🔵 |
| `UserDeactivated` | 🟢 | | | | | 🔵 |
| `UserRoleChanged` | 🟢 | | | | 🔵 | |

🟢 = Productor | 🔵 = Consumidor planificado (ningn consumer est suscrito an en EventBridge).

---

## 5. Eventos planificados (futuros contextos)

> **No en cdigo**. Documentados para fijar el contrato anticipado. **No**
> se pueden consumir an: el handler no existe.

### 5.1 AssessmentStarted (planned)

**Producido por**: Assessment Context → `assessments.create()`.  
**Trigger**: `POST /v1/assessments`.

```json
{
  "schemaVersion": "1.0",
  "occurredAt": "2026-...",
  "assessmentId": "uuid-v4",
  "userId": "uuid-v4",
  "assessmentType": "riasec | big-five | vocational-interests",
  "totalQuestions": 30
}
```

### 5.2 AssessmentCompleted (planned)

**Producido por**: Assessment Context. **Consumidores clave**: Matching.

```json
{
  "schemaVersion": "1.0",
  "occurredAt": "2026-...",
  "assessmentId": "uuid-v4",
  "userId": "uuid-v4",
  "assessmentType": "riasec | big-five | vocational-interests",
  "durationSeconds": 420,
  "result": {
    "riasec": { "R": 70, "I": 40, "A": 80, "S": 60, "E": 50, "C": 55 }
  }
}
```

### 5.3 CareerCreated (planned)

**Producido por**: Career Context. **Consumidores clave**: AI Advisor
(reindex RAG), Matching.

### 5.4 CareerUpdated (planned)

**Producido por**: Career Context. **Consumidores clave**: AI Advisor
(reindex RAG), Matching (recalcular scores).

### 5.5 RecommendationGenerated (planned)

**Producido por**: Matching Context. **Consumidores clave**: Notifications,
Analytics.

### 5.6 MessageSent (planned)

**Producido por**: AI Advisor Context (otro repo).

### 5.7 KnowledgeDocIngested (planned)

**Producido por**: AI Advisor Context.

> Los payloads exactos de § 4.3–§ 4.7 estn pendientes de freeze. Se copiarn
> del repo `spark-match-07-deep-agent` cuando esos contextos existan.

---

## 6. Versionado histrico

| Evento | v1 publicado | Notas |
|---|---|---|
| `UserRegistered` | 2026-07-28 (freeze real) | Antes documentado con campos errneos (`profileCompleted`, `locale`); corregido en esta revisin. |
| `UserLoggedIn` | 2026-07-28 (aadido) | No exista en el catlogo previo. |
| `UserPasswordChanged` | 2026-07-28 (aadido) | No exista en el catlogo previo. |
| `UserUpdated` | 2026-07-28 (renombrado) | Antes mal llamado `ProfileUpdated`. Cdigo siempre emiti `UserUpdated`. |
| `UserActivated` | 2026-07-28 (aadido) | No exista en el catlogo previo. |
| `UserDeactivated` | 2026-07-28 (aadido) | No exista en el catlogo previo. |
| `UserRoleChanged` | 2026-07-28 (aadido) | No exista en el catlogo previo. |

---

## 7. Prximos eventos a documentar (backlog)

- `MatchingFailed` — cuando el engine no puede generar recomendaciones.
- `ConversationStarted` — para analytics de engagement.
- `UserDeleted` — GDPR / right to be forgotten (cascade cleanup).
- `RecommendationFeedback` — usuario marca like/dislike de recomendacin.