# ADR-017: Arquitectura del bounded context Notifications (2026)

**Estado**: Propuesto · **Fecha**: 2026-07-30

> Investigación realizada el 2026-07-30 contra documentación oficial de AWS (AWS Messaging Blog, jul-2026) y la arquitectura de referencia existente en `spark-match-03-backend`.

## Contexto

El producto CareerMatch Perú (orientación vocacional con IA) requiere enviar notificaciones transaccionales a usuarios finales: bienvenida al registrarse, recuperación de contraseña, magic link, confirmación de cuestionario completado, "tu recomendación está lista", recordatorios de cuestionario incompleto, alertas de cambios en el catálogo de carreras, etc. Los usuarios están mayoritariamente en Perú, donde **WhatsApp es el canal de mensajería dominante** (penetración >90% en smartphones), seguido de email. SMS tiene costos altos y requiere registro de carrier (4-6 semanas).

Hoy no existe implementación de notificaciones. Identity emite eventos a EventBridge (ADR-005) cuando un usuario se registra o cambia perfil, pero ningún consumidor los transforma en delivery. La infra serverless (Lambda + SQS + EventBridge) ya está estandarizada vía ADR-006 y el patrón de choreography + DLQ + idempotencia.

Necesitamos decidir:

1. **¿Quién entrega las notificaciones?** (sync en handler producer vs async vía cola).
2. **¿Qué canales soportar en MVP?** (solo email, email + WhatsApp, todos).
3. **¿Cómo gestionar templates?** (hardcoded en código vs S3 versioned).
4. **¿Cómo evitar duplicados?** (SQS standard vs SQS FIFO + idempotencia por notification_id).
5. **¿Qué SDK/provider usar para WhatsApp?** (Meta directo vs AWS End User Messaging Social vs Twilio).

## Estado del arte AWS (jul-2026, verificado)

Antes de proponer opciones, esto es lo que AWS ofrece hoy, **no lo que ofrecía hace 12 meses**:

- **AWS End User Messaging** es el servicio unificado de messaging.
  - **Notify** (sub-servicio): SMS/OTP transaccional, 200+ países, no requiere provisionar números ni carrier registration. Mandatory SMS Protect (anti-fraud). Basic tier: 1 TPS, 200 msg/día. Advanced: 25 TPS, ilimitado. API: `pinpoint-sms-voice-v2`. **Perú fully managed en Advanced tier** (verificado vía `list-notify-countries`).
  - **Social** (sub-servicio): WhatsApp Business + LINE Messenger. API: `social-messaging SendWhatsAppMessage`. Costo por conversation (utility ~$0.025 USD, marketing ~$0.08 USD, ventana 24h).
- **Amazon SES** nuevos pricing plans (jul-2026): bundles incluidos (dedicated IPs, Virtual Deliverability Manager, suppression lists) hasta 22% más barato que comprarlos sueltos. Multi-tenancy con suppression lists aislados por tenant (feature nueva jul-2026).
- Existe una **arquitectura de referencia oficial** publicada por AWS para omnichannel fallback (WhatsApp + SMS + email) usando API Gateway + SQS + Lambda + SNS callbacks + DynamoDB status table. Aplica los mismos patrones que ya usamos (ADR-006).
- Bedrock AgentCore + Strands Agents SDK es el framework oficial AWS para AI agents (relevante para integración con `spark-match-07-deep-agent` y channel orchestration con AI, pero fuera de MVP).

## Opciones consideradas

### Opción A: In-handler sync (no recomendado)

El handler de Identity envía el email directamente vía SES SDK antes de retornar al cliente.

| Pros | Contras |
|---|---|
| Latencia cero para el usuario | Productor acoplado al canal; un proveedor caído rompe el flujo de registro |
| Sin infra adicional | Si SES rate-limita, el registro falla |
| Simple | Cero observabilidad del delivery; cero retry; cero DLQ |
| | Imposible añadir WhatsApp después sin tocar Identity |
| | Productor paga el costo del envío |

### Opción B: Notifications como bounded context propio + SQS FIFO + DLQ + idempotencia por `notification_id` + SES MVP

Notifications es un nuevo BC (`contexts/notifications/`) que consume eventos de EventBridge. Productores NO saben que existe. Worker idempotente vía UUID `notification_id` (constraint UNIQUE en tabla `notifications.notification_delivery`). Templates en S3 versioned con renderizado Handlebars. Multi-canal: SES (email) en Fase 1, EUM Social (WhatsApp) en Fase 2, fallback automático en Fase 3.

| Pros | Contras |
|---|---|
| Desacople total productores ↔ canales | Latencia E2E +5-15s (acceptable para transaccional) |
| Un productor → N canales sin cambios al BC emisor | +1 bounded context (+ migrations, + tests, +运维) |
| Retry + DLQ por canal; cero pérdida silenciosa | Más infra: SQS + DLQ + EventBridge rules + IAM scoped + S3 templates bucket |
| Idempotencia garantiza "exactly-once delivery" | Onboarding WhatsApp Business (Meta) = 1-2 semanas |
| Templates editables sin redeploy | SES sandbox exit = ~24h |
| Per-user preferences + i18n + quiet hours listos para futuro | |
| Channel-agnostic: añadir push/SMS mañana = 1 nuevo módulo | |
| Observabilidad dedicada: queue depth + delivery rate por canal | |

### Opción C: SaaS externo (Knock / OneSignal / Customer.io / Postmark)

Terceriza todo el delivery a un servicio especializado.

| Pros | Contras |
|---|---|
| Menos código propio | Vendor lock-in; pricing por volumen escala mal |
| Features avanzadas out-of-box (campaigns, A/B, analytics) | Datos de usuarios peruanos salen fuera del control de spark-match |
| | Costo 5-10x mayor que SES+EUM a escala |
| | Para MVP transaccional es overkill |

### Opción D: Lambda Powertools Idempotency built-in + state en DynamoDB

Igual que B pero usando el módulo `@aws-lambda-powertools/idempotency` con persistencia en DynamoDB en vez de PostgreSQL.

| Pros | Contras |
|---|---|
| Menos código de idempotencia (Powertools hace el wrapping) | Acopla notifications a DynamoDB (no tenemos DynamoDB en el repo hoy) |
| | DynamoDB = otro recurso que provisionar/costear/monitorizar |
| | PostgreSQL ya está pagado y operativo (Identity lo usa) |

**Descartado**: el costo de introducir DynamoDB solo para idempotencia no se justifica cuando ya tenemos PostgreSQL Serverless v2 listo y un schema `notifications` disponible.

## Decisión

**Opción B**, en 4 fases incrementales. La fase 1 (MVP) entrega SES + SQS FIFO + DLQ + idempotencia + templates S3 + per-user preferences para los eventos `user.registered`, `user.password_reset_requested` y `assessment.completed`. WhatsApp se añade en fase 2 con su propio PR.

**Capas de la implementación:**

1. **Productor (cualquier BC)** emite evento a EventBridge con `notification_id` (UUID v4) en `detail.metadata`. El productor NO sabe qué canales se entregarán.
2. **EventBridge rule** pattern-matchea el source/detail-type y fan-out a la SQS FIFO `notifications-incoming` (DLQ: `notifications-incoming-dlq`, retention 14d, alarm vía CloudWatch).
3. **Worker Lambda** (`contexts/notifications/src/handlers/worker.ts`):
   1. Parsea el evento. Extrae `notification_id` + `user_id` + `template_key`.
   2. `SELECT ... FROM notifications.notification_preferences WHERE user_id = ? AND enabled = true`.
   3. Por cada canal habilitado: renderiza template desde `s3://spark-match-notifications-templates/{locale}/{template_key}.{channel}.{ext}` con Handlebars, persiste fila en `notifications.notification_delivery` con `UNIQUE(notification_id, channel)`. Si ya existe → skip (idempotencia).
   4. Llama al adapter del canal (`SESAdapter`, `WhatsAppAdapter`, etc.).
   5. Persiste el resultado (status, provider_message_id, error_code si falla).
4. **Provider adapters** implementan interface `NotificationChannel`: `send(notification): Promise<{ providerMessageId, status }>`. SES usa `SESv2Client.sendEmail`. WhatsApp usa `social-messaging SendWhatsAppMessage`. Cada adapter envuelve errores con `withAwsErrorMapping` (ya existente).
5. **Delivery callbacks** (async vía SNS): SES publica `Delivery`, `Bounce`, `Complaint` events a un topic; EUM Social publica WhatsApp delivery receipts al mismo topic. Una Lambda delivery-tracker actualiza `notifications.notification_delivery.status`.

**Failure modes cubiertos:**

| Falla | Mitigación |
|---|---|
| Canal temporalmente caído | Retry con exponential backoff + jitter (max 3) |
| Usuario deshabilitó canal | Fallback al siguiente preferido (email → WhatsApp → SMS) |
| Hard bounce / complaint | SES suppression list + flag `user.email_invalid` (futuro) |
| WhatsApp rate limit | EUM Social maneja rate limits; circuit breaker si >N fallos/5min |
| Worker crash mid-flight | SQS visibility timeout (60s) → re-delivery automático |
| Evento duplicado | UNIQUE constraint en `(notification_id, channel)` → INSERT ON CONFLICT DO NOTHING |
| Provider quota excedido | CloudWatch alarm + AWS Budget alert |
| Template render falla | DLQ + alert; **fail-closed** (no bypass, no skip) |
| EventBridge down | Productor hace buffering local en PostgreSQL outbox (futuro, no MVP) |

**Idempotencia:** constraint `UNIQUE(notification_id, channel)` en `notifications.notification_delivery`. Worker hace `INSERT ... ON CONFLICT DO NOTHING RETURNING id`. Si la fila ya existe (porque SQS redelivery), el INSERT no devuelve nada y el worker sabe que ya envió → no redelivery al provider. Esto es el mismo patrón que AWS Powertools Idempotency pero con persistencia en PostgreSQL (que ya tenemos) en vez de DynamoDB.

**Templates:** S3 bucket `spark-match-notifications-templates` con versioning habilitado. Key format: `{locale}/{template_key}.{channel}.{ext}` (e.g. `es/user-registered.email.html`). Renderizado con Handlebars (~5KB dep, sin runtime extra). **Por qué S3 y no hardcoded**: copy cambia sin redeploy; rollback trivial (versionado); i18n natural (multiples `locale/`); marketing y ops pueden editar sin pedir PR al equipo backend.

**Observabilidad:**
- Powertools Metrics: counters `notifications.sent{channel}`, `notifications.delivered{channel}`, `notifications.failed{channel,reason}`. EMF → CloudWatch.
- X-Ray traces: producer → EventBridge → SQS → Lambda → SES/EUM. Annotation `notification_id`.
- Structured logs: cada log line lleva `notification_id`, `event_source`, `channel`, `attempt`. CloudWatch Logs Insights para queries.
- Dashboard CloudWatch: queue depth, success rate por canal, p50/p99 latency, DLQ size.
- Alarm: DLQ > 0 mensajes por >5min → notify on-call.

**Canales MVP (CareerMatch Perú):**

| Canal | Provider | Cuándo entra | Justificación |
|---|---|---|---|
| Email | Amazon SES | Fase 1 (MVP) | Universal, sandbox exit ~24h, $0.10/1000 |
| WhatsApp | EUM Social | Fase 2 | Primary en Perú, Meta verification 1-2 sem, $0.025/conv utility |
| SMS | EUM Notify | Fase 4 (post carrier reg) | Solo OTP crítico, registration 4-6 sem Perú |
| Web Push (FCM) | Directo o via Pinpoint | Fase 5+ (no MVP) | Browser reminders |
| In-app | WebSocket via API Gateway | Fase 5+ (no MVP) | Real-time |

**Decisión Perú-específica:** arrancar con email (universal) y WhatsApp (primary cultural). SMS solo cuando tengamos carrier registration (4-6 semanas de proceso). WhatsApp Business verification (Meta) puede correr en paralelo desde día 1.

**Cost control:**
- SES Basic plan para dev; production access en Fase 1 release.
- EUM Notify Basic tier gratis durante dev (1 TPS, 200 msg/día).
- WhatsApp: solo templates utility aprobados por Meta en MVP (no marketing).
- AWS Budget alarm al 80% del budget mensual estimado.

**Compliance:**
- WhatsApp: requiere opt-in del usuario (futuro flag `user.whatsapp_opted_in`). Sin opt-in, NO enviar (Meta banea cuentas).
- SMS: requiere opt-in explícito en Perú (normativa Osiptel). Documentado en template registry.
- RGPD-style: transactional exento de opt-out, marketing requiere doble opt-in (futuro, no MVP).

## Consecuencias

**Positivas:**
- Cero acoplamiento entre BCs productores y canales (cumple ADR-003, ADR-006).
- Idempotencia garantiza que WhatsApp Meta nunca reciba duplicados (crítico: Meta penaliza repetición).
- Templates editables sin redeploy → marketing/ops autonomía.
- Fail-closed: cualquier fallo va a DLQ + alarm, nunca silent drop.
- Observabilidad dedicada por canal + cost dashboards.
- Channel-agnostic: añadir push/SMS/in-app en fases siguientes = 1 nuevo adapter + EventBridge rule.
- Per-user preferences + i18n + quiet hours listos (Post-MVP).
- Patrón reutilizable: cualquier nuevo BC productor puede emitir eventos a Notifications sin tocarse.

**Negativas:**
- Latencia E2E +5-15s vs in-handler sync. Aceptable para transaccional; cuestionable para OTP donde el usuario espera <2s (Fase 4 SMS sync).
- +1 bounded context = +migrations, +tests, +运维, +dashboard.
- Onboarding WhatsApp Business (Meta verification) = 1-2 semanas. **Acción: arrancar el proceso en paralelo desde día 1 de Fase 2**, no esperar a codear Fase 2.
- SES sandbox exit = ~24h (form de producción). **Acción: hacerlo antes del primer release a prod.**
- SMS Perú carrier registration = 4-6 semanas. **Acción: si Fase 4 está en roadmap, arrancar el proceso YA, no esperar.**

**Mitigaciones:**
- Latencia: usar EventBridge rule con `retain` policy que prioriza baja latencia; medir p50/p95/p99 end-to-end desde el primer PR de Fase 1.
- Onboarding Meta: ticket de plataforma con timeline en el runbook (Sprint planning Fase 2).
- SES sandbox: `docs/runbook.md` documenta el form + SLA de AWS.
- SMS carrier: `docs/runbook.md` documenta el proceso Osiptel.
- Idempotencia: tests automatizados verifican que redelivery de la misma `notification_id` no genera segundo envío (integration test con SQS test event).

## Fases de implementación (resumen)

| Fase | Scope | Sprints | Output |
|---|---|---|---|
| **Fase 1** | Email + SQS FIFO + DLQ + idempotencia + templates S3 | 2 | `GET /v1/notifications/preferences` + worker básico + 3 templates ES |
| **Fase 2** | WhatsApp + channel router + delivery tracking | 1-2 | Multi-canal; delivery status via SNS callbacks |
| **Fase 3** | Observability dashboard + CloudWatch alarms | 0.5 | Dashboard producción; runbook |
| **Fase 4** | SMS (post carrier registration) + fallback automático | 1 | 3 canales + fallback chain |
| **Fase 5** | AI channel orchestrator (Bedrock) | 2 | Predice mejor canal por user (low priority MVP) |

## Out of scope explícito

- Marketing campaigns (requiere opt-in explícito, RGPD-style).
- AI-orchestrated channel selection (Bedrock) — Fase 5.
- In-app realtime notifications (WebSocket) — Fase 5+.
- Web Push (FCM) — Fase 5+.
- SMS en MVP — Fase 4 (post carrier registration).

## Referencias

- AWS Messaging Blog, jul-2026: ["Getting started with AWS End User Messaging Notify"](https://aws.amazon.com/blogs/messaging-and-targeting/getting-started-with-aws-end-user-messaging-notify/) — confirma Notify para SMS/OTP transaccional.
- AWS Messaging Blog, jul-2026: ["Adding LINE Messenger to your AWS omnichannel fallback solution"](https://aws.amazon.com/blogs/messaging-and-targeting/adding-line-messenger-to-your-aws-omnichannel-fallback-solution/) — arquitectura de referencia oficial para omnichannel (WhatsApp + SMS + email) que aplica a spark-match.
- AWS Messaging Blog, jun-2026: ["Build an AI-powered WhatsApp assistant with Strands Agents SDK and AWS End User Messaging Social"](https://aws.amazon.com/blogs/messaging-and-targeting/build-an-ai-powered-real-estate-assistant-on-whatsapp-using-strands-agents-sdk-and-aws-end-user-messaging/) — patrón de integración WhatsApp con AI agents (relevante para `spark-match-07-deep-agent`).
- AWS Messaging Blog, jul-2026: ["Isolate email suppression per tenant with Amazon SES"](https://aws.amazon.com/blogs/messaging-and-targeting/isolate-email-suppression-per-tenant-with-amazon-ses/) — feature nueva no aplicable a MVP (single tenant), pero arquitectura ya la soporta.
- [AWS End User Messaging Social — SendWhatsAppMessage API](https://docs.aws.amazon.com/social-messaging/latest/APIReference/API_SendWhatsAppMessage.html) — API oficial WhatsApp Business.
- ADR-005 (EventBridge como bus principal) y ADR-006 (coreografía + DLQ + idempotencia) — bases arquitectónicas sobre las que se construye Notifications.
- `BACKEND-UPGRADE.md` §15 Fase 9 — placeholder original para Notifications, reemplazado por este ADR.