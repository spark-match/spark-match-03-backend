# ADR-018: Throttling strategy (3 capas — API Gateway + WAF + app-level)

**Estado**: Propuesto · **Fecha**: 2026-07-31

> Discusión originada en sesión sobre maduración del Identity context (2026-07-31). El usuario preguntó si, dado que todo el tráfico pasa por API Gateway, el rate limit no debería ir ahí. Respuesta corta: **sí para el grueso (Layer 1)**, **no para brute force / per-user (Layer 2 + 3)**. Este ADR formaliza la estrategia de 3 capas.

## Contexto

Identity context está madurando (Sprint 3 P3 cerrado, B8 cerrado). Próximos riesgos a mitigar:

1. **Ataques masivos / DDoS** contra endpoints públicos (`POST /v1/auth/register`, `POST /v1/auth/login`).
2. **Brute force** en login: atacante probando miles de passwords contra un email conocido.
3. **Abuso por usuario legítimo**: un user con session válida haciendo scraping o rate-intensive queries (e.g., `GET /v1/audit` con filtros agresivos).
4. **Costo descontrolado** por Lambda invocations masivas (cada request = $$).

Hoy no hay rate limiting implementado. El código de error `too_many_requests` (HTTP 429) está definido en `error-catalog.md` pero nunca se lanza — el comentario dice "Rate limiting (futuro)".

## Estado del arte (HTTP API v2 vs REST API vs WAF)

API Gateway tiene 3 niveles de protección, con capacidades distintas:

| Capa | Mecanismo | Granularidad | Coste | Latencia |
|---|---|---|---|---|
| **API Gateway throttling** | `AWS::ApiGatewayV2::Route ThrottleSettings` (Rate + Burst) | Per-route o per-stage | **Gratis** (incluido) | <1ms |
| **AWS WAF rate-based rule** | WebACL + rate-based statement (req/periodo/IP) | Per-IP, per-IP+URI pattern, per-IP+header | ~$5/mes base + $1/M requests | ~5-10ms |
| **App-level** | Lambda middleware + DB state | Per-user, per-endpoint, custom logic | DB writes (RDS) | ~10-50ms |

**HTTP API v2 vs REST API v1**: HTTP API v2 (elegido en ADR-009 por menor latencia y costo) **NO soporta** usage plans ni API keys. Su throttling es solo per-route / per-stage. **Para per-IP granular** se necesita WAF (que funciona delante de HTTP API v2 igual que delante de REST).

## Opciones consideradas

### Opción A: Solo API Gateway throttling (Layer 1 only)

Configurar `ThrottleSettings` en cada `AWS::ApiGatewayV2::Route` con Rate + Burst razonables. Sin código nuevo.

| Pros | Contras |
|---|---|
| Cero código, cero coste | No distingue user legítimo de atacante en login |
| Cubre DDoS / abuse global | No implementa account lockout (brute force sigue posible si rate es alto) |
| Setup en ½ día | Rate global puede ser muy permisivo si hay legit traffic spikes |

### Opción B: API Gateway + WAF (Layer 1 + 2)

API Gateway para coarse + WAF con rate-based rule específica en `/v1/auth/login` (e.g., 100 req / 5min / IP).

| Pros | Contras |
|---|---|
| Cubre DDoS + brute force IP-based en login | WAF añade latencia (~5-10ms) y coste (~$5-20/mes) |
| Logging centralizado de ataques bloqueados | Más infra que monitorear (WebACL, métricas WAF) |
| Sin cambios de código de aplicación | Aún no implementa per-user account lockout (Layer 3) |

### Opción C: Las 3 capas

API Gateway coarse + WAF en auth/* + app-level per-user lockout (counter `failed_login_attempts` en `identity.users` + audit row `user.locked_out`).

| Pros | Contras |
|---|---|
| Defense in depth completo | 3 sistemas que monitorear |
| Per-user protection (lockout específico del atacante) | Layer 3 añade DB writes por login (mitigable: solo escribir si falla) |
| Cumple "5 intentos → 15min lock" tipo OWASP | Complejidad operativa |

### Opción D: Solo app-level (Layer 3 only)

| Pros | Contras |
|---|---|
| No infra nueva | El atacante llega a la Lambda → DB → RDS en cada request → $$ aún en ataques |
| Control total de la lógica | DB queda como single point of failure (si falla, no rate limit) |

**Descartado**: A es insuficiente (brute force); D es riesgoso (sin protección global).

## Decisión

**Opción C (3 capas)**, implementada en 2 PRs incrementales:

### PR-1 (Layer 1) — API Gateway throttling — **XS, ~1 día**

`template.yaml` + `contexts/identity/template.yaml`:
- Default throttling per-route con valores razonables:
  - `/v1/auth/register`: 5 req/s, burst 10 (anti-bot signup)
  - `/v1/auth/login`: 5 req/s, burst 10 (anti-brute-force IP-level básico)
  - `/v1/audit`: 20 req/s, burst 40 (query costosa)
  - resto: 50 req/s, burst 100 (default razonable)
- Sin código nuevo. Sin coste extra. Solo infra.
- Cubre: DDoS global + abuse masivo.

### PR-2 (Layer 3) — App-level account lockout — **S, ~1 sprint**

Migración V005:
- Añadir columnas a `identity.users`: `failed_login_attempts SMALLINT NOT NULL DEFAULT 0`, `locked_until TIMESTAMPTZ`.
- Cambiar `login.ts`:
  - Si `locked_until > NOW()` → 423 Locked con `auth.account_locked` detail.
  - En cada login fallido: `UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE email = ?`.
  - Si counter >= 5: `UPDATE users SET failed_login_attempts = 0, locked_until = NOW() + INTERVAL '15 minutes'`.
  - Si login exitoso: `UPDATE users SET failed_login_attempts = 0, locked_until = NULL`.
- Audit row `user.locked_out` cuando se dispara el lock.
- Cubre: brute force persistente que burla el rate de Layer 1.

### Layer 2 (WAF) — **Deferred**

Implementar **solo si vemos tráfico sospechoso real** en logs (CloudWatch metric `4XX > threshold` + manual analysis). Cuesta ~$5-20/mes y suma complejidad operativa. Para MVP en Perú (mercado inicial bajo tráfico) es overkill.

## Configuración propuesta (PR-1)

```yaml
# template.yaml — Global default
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
- Layer 1 cubre el 80% del riesgo (DDoS, abuse masivo) con coste $0 y esfuerzo XS.
- Layer 3 da defense in depth per-user sin infra nueva (usa RDS existente).
- Estrategia explícita y documentada — fácil de extender cuando crezca el tráfico (Layer 2 cuando haga falta).
- Audit log extendido: `user.locked_out` da visibilidad de intentos de brute force.

**Negativas:**
- Layer 1 puede ser demasiado permisivo en pico de tráfico legítimo (e.g., vuelta a clases en marzo). Mitigación: empezar conservador, subir si vemos 429 en logs de legit users.
- Layer 3 añade 1-2 DB writes por login (incl. en path exitoso). Mitigable con batch update o eventual consistency.
- 429 de API Gateway no customiza el body (formato fijo). Si queremos nuestro envelope JSON, hay que capturarlo en el client. No es bloqueante para MVP.
- Account lockout tiene riesgo de DoS legítimo (atacante lockea cuentas ajenas con intentos fallidos). Mitigable: lockout también si password es **muy obvia** vs muchos intentos con password distinta (heurística Layer 3 más sofisticada en futuro).

**Mitigaciones:**
- Monitorear CloudWatch `4xx` rate por route. Si >0.1% legit users → subir Rate/Burst.
- Audit `user.locked_out` con `actor=unknown` (sistema, no user real) + `metadata: { reason: 'failed_attempts_threshold', attemptCount: 5 }` para detección de patrones de ataque.
- En futuro: añadir "unlock via email verification" como self-service.

## Out of scope

- WAF (Layer 2) — deferred hasta que el tráfico lo justifique.
- Bot detection / Turnstile / hCaptcha en `/v1/auth/register` — separado, no parte de throttling.
- Rate limit per-API-key (no aplica; no usamos API keys, solo JWT de usuario).
- Geo-blocking — no parte de MVP.

## Referencias

- ADR-009 (HTTP API Gateway v2 over REST) — explica por qué no tenemos usage plans.
- ADR-013 (Middy + Zod + Powertools stack) — `buildHandler` es donde iría Layer 3 middleware.
- ADR-015 (audit log writes) — `user.locked_out` extiende el catálogo de actions.
- AWS docs: [Throttle requests to your HTTP API in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html)
- AWS docs: [AWS WAF rate-based rule statement](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html)
- `docs/error-catalog.md` — `too_many_requests` (429) ya definido pero nunca emitido.