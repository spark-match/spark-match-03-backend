# ADR-018: Throttling strategy (Edge + Per-IP + Per-account)

**Estado**: Aceptado · **Fecha**: 2026-07-31 (revisado 2026-07-31: rename "Layer 1/2/3" → "Edge / Per-IP / Per-account"; revisado 2026-08-04: marcado Aceptado tras implementación de Edge throttling en `contexts/identity/template.yaml`)

> Discusión originada en sesión sobre maduración del Identity context (2026-07-31). El usuario preguntó si, dado que todo el tráfico pasa por API Gateway, el rate limit no debería ir ahí. Respuesta corta: **sí para el grueso (Edge throttling)**, **no para brute force / per-user (Per-account lockout)**. Este ADR formaliza la estrategia de 3 mecanismos con naming descriptivo (no "Layer N", que no comunica qué hace cada uno).

## Contexto

Identity context está madurando (Sprint 3 P3 cerrado, B8 cerrado). Próximos riesgos a mitigar:

1. **Ataques masivos / DDoS** contra endpoints públicos (`POST /v1/auth/register`, `POST /v1/auth/login`).
2. **Brute force** en login: atacante probando miles de passwords contra un email conocido.
3. **Abuso por usuario legítimo**: un user con session válida haciendo scraping o rate-intensive queries (e.g., `GET /v1/audit` con filtros agresivos).
4. **Costo descontrolado** por Lambda invocations masivas (cada request = $$).

Hoy no hay rate limiting implementado. El código de error `too_many_requests` (HTTP 429) está definido en `error-catalog.md` pero nunca se lanza — el comentario dice "Rate limiting (futuro)".

## Estado del arte (HTTP API v2 vs REST API vs WAF)

AWS ofrece 3 mecanismos de throttling, con capacidades y costes distintos:

| Mecanismo | Granularidad | Coste | Latencia | Cuándo protege |
|---|---|---|---|---|
| **Edge throttling** (`AWS::Serverless::HttpApi::Route ThrottleSettings`) | Per-route o per-stage | **Gratis** (incluido) | <1ms | DDoS, abuse global |
| **Per-IP rate limiting** (AWS WAF rate-based rule) | Per-IP, per-IP+URI pattern, per-IP+header | ~$5/mes base + $1/M requests | ~5-10ms | Brute force desde IP fija |
| **Per-account lockout** (Lambda middleware + DB state) | Per-user, per-endpoint, custom logic | DB writes (RDS) | ~10-50ms | Brute force persistente / per-user |

**HTTP API v2 vs REST API v1**: HTTP API v2 (elegido en ADR-009 por menor latencia y costo) **NO soporta** usage plans ni API keys. Su throttling es solo per-route / per-stage. **Para per-IP granular** se necesita WAF (que funciona delante de HTTP API v2 igual que delante de REST).

## Opciones consideradas

### Opción A: Solo Edge throttling

Configurar `ThrottleSettings` en cada `AWS::Serverless::HttpApi::Route` con Rate + Burst razonables. Sin código nuevo.

| Pros | Contras |
|---|---|
| Cero código, cero coste | No distingue user legítimo de atacante en login |
| Cubre DDoS / abuse global | No implementa account lockout (brute force sigue posible si rate es alto) |
| Setup en ½ día | Rate global puede ser muy permisivo si hay legit traffic spikes |

### Opción B: Edge throttling + Per-IP (WAF)

Edge para coarse + WAF con rate-based rule específica en `/v1/auth/login` (e.g., 100 req / 5min / IP).

| Pros | Contras |
|---|---|
| Cubre DDoS + brute force IP-based en login | WAF añade latencia (~5-10ms) y coste (~$5-20/mes) |
| Logging centralizado de ataques bloqueados | Más infra que monitorear (WebACL, métricas WAF) |
| Sin cambios de código de aplicación | Aún no implementa per-account lockout |

### Opción C: Las 3 (Edge + Per-IP + Per-account)

Edge coarse + Per-IP en auth/* + Per-account lockout (counter `failed_login_attempts` en `identity.users` + audit row `user.locked_out`).

| Pros | Contras |
|---|---|
| Defense in depth completo | 3 sistemas que monitorear |
| Per-user protection (lockout específico del atacante) | Per-account añade DB writes por login (mitigable: solo escribir si falla) |
| Cumple "5 intentos → 15min lock" tipo OWASP | Complejidad operativa |

### Opción D: Solo Per-account (app-level only)

| Pros | Contras |
|---|---|
| No infra nueva | El atacante llega a la Lambda → DB → RDS en cada request → $$ aún en ataques |
| Control total de la lógica | DB queda como single point of failure (si falla, no rate limit) |

**Descartado**: A es insuficiente (brute force); D es riesgoso (sin protección global).

## Decisión

**Opción C**, implementada en 2 PRs incrementales:

### PR-1 — Edge throttling (API Gateway per-route Rate/Burst) — **XS, ~1 día**

`template.yaml` + `contexts/identity/template.yaml`:
- Default throttling per-route con valores razonables:
  - `/v1/auth/register`: 5 req/s, burst 10 (anti-bot signup)
  - `/v1/auth/login`: 5 req/s, burst 10 (anti-brute-force IP-level básico)
  - `/v1/audit`: 20 req/s, burst 40 (query costosa)
  - resto: 50 req/s, burst 100 (default razonable)
- Sin código nuevo. Sin coste extra. Solo infra.
- Cubre: DDoS global + abuse masivo.

### PR-2 — Per-account lockout (app-level) — **S, ~1 sprint**

Migración V005:
- Añadir columnas a `identity.users`: `failed_login_attempts SMALLINT NOT NULL DEFAULT 0`, `locked_until TIMESTAMPTZ`.
- Cambiar `login.ts`:
  - Si `locked_until > NOW()` → 423 Locked con `auth.account_locked` detail.
  - En cada login fallido: `UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE email = ?`.
  - Si counter >= 5: `UPDATE users SET failed_login_attempts = 0, locked_until = NOW() + INTERVAL '15 minutes'`.
  - Si login exitoso: `UPDATE users SET failed_login_attempts = 0, locked_until = NULL`.
- Audit row `user.locked_out` cuando se dispara el lock.
- Cubre: brute force persistente que burla el Edge throttling.

### Per-IP rate limiting (WAF) — **Deferred**

Implementar **solo si vemos tráfico sospechoso real** en logs (CloudWatch metric `4XX > threshold` + manual analysis). Cuesta ~$5-20/mes y suma complejidad operativa. Para MVP en Perú (mercado inicial bajo tráfico) es overkill.

## Configuración propuesta (PR-1)

```yaml
# template.yaml — Default global para el HttpApi
ThrottleSettings:
  RateLimit: 50.0   # req/s por route
  BurstLimit: 100

# contexts/identity/template.yaml — Per-route overrides
- AuthRegisterRoute:
    Path: /v1/auth/register
    Method: POST
    ThrottleSettings:
      RateLimit: 5.0
      BurstLimit: 10

- AuthLoginRoute:
    Path: /v1/auth/login
    Method: POST
    ThrottleSettings:
      RateLimit: 5.0
      BurstLimit: 10

- AuditRoute:
    Path: /v1/audit
    Method: GET
    ThrottleSettings:
      RateLimit: 20.0
      BurstLimit: 40
```

(Los valores exactos se afinan en el PR-1 con datos de tráfico esperado del MVP.)

## Consecuencias

**Positivas:**
- Edge throttling cubre el 80% del riesgo (DDoS, abuse masivo) con coste $0 y esfuerzo XS.
- Per-account lockout da defense in depth per-user sin infra nueva (usa RDS existente).
- Estrategia con naming descriptivo (Edge/Per-IP/Per-account) — cada mecanismo comunica QUÉ hace, no solo su posición en una pila.
- Fácil de extender cuando crezca el tráfico (añadir Per-IP WAF sin tocar los otros 2).
- Audit log extendido: `user.locked_out` da visibilidad de intentos de brute force.

**Negativas:**
- Edge throttling puede ser demasiado permisivo en pico de tráfico legítimo (e.g., vuelta a clases en marzo). Mitigación: empezar conservador, subir si vemos 429 en logs de legit users.
- Per-account lockout añade 1-2 DB writes por login (incl. en path exitoso). Mitigable con batch update o eventual consistency.
- 429 de API Gateway no customiza el body (formato fijo). Si queremos nuestro envelope JSON, hay que capturarlo en el client. No es bloqueante para MVP.
- Per-account lockout tiene riesgo de DoS legítimo (atacante lockea cuentas ajenas con intentos fallidos). Mitigable: heurística Per-account más sofisticada en futuro (e.g., lockout también si password es **muy obvia** vs muchos intentos con password distinta).

**Mitigaciones:**
- Monitorear CloudWatch `4xx` rate por route. Si >0.1% legit users → subir Rate/Burst.
- Audit `user.locked_out` con `actor=unknown` (sistema, no user real) + `metadata: { reason: 'failed_attempts_threshold', attemptCount: 5 }` para detección de patrones de ataque.
- En futuro: añadir "unlock via email verification" como self-service.

## Out of scope

- WAF Per-IP (mecanismo intermedio) — deferred hasta que el tráfico lo justifique.
- Bot detection / Turnstile / hCaptcha en `/v1/auth/register` — separado, no parte de throttling.
- Rate limit per-API-key (no aplica; no usamos API keys, solo JWT de usuario).
- Geo-blocking — no parte de MVP.

## Referencias

- ADR-009 (HTTP API Gateway v2 over REST) — explica por qué no tenemos usage plans.
- ADR-013 (Middy + Zod + Powertools stack) — `buildHandler` es donde iría Per-account middleware.
- ADR-015 (audit log writes) — `user.locked_out` extiende el catálogo de actions.
- AWS docs: [Throttle requests to your HTTP API in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html)
- AWS docs: [AWS WAF rate-based rule statement](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html)
- `docs/error-catalog.md` — `too_many_requests` (429) ya definido pero nunca emitido.