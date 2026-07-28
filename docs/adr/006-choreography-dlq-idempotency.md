# ADR-006: Coreografía + DLQ + idempotencia (sin orquestador)


**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

Cuando un evento dispara varios pasos (ej: AssessmentCompleted → Matching → Notification), ¿cómo coordinamos?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Coreografía pura** | Simple, sin coordinador central | Difícil ver el flujo completo |
| Coreografía + DLQ + idempotencia | Resiliente, recuperable | Más código en cada handler |
| Orquestación con Step Functions | Visualización clara, retries nativos | Más infra, vendor lock-in |

### Decisión

**Coreografía + SQS DLQ por regla + idempotencia por `eventId`**.

### Consecuencias

**Positivas**:
- Sin punto único de fallo (coordinador)
- Cada handler es independiente y testeable en aislamiento
- Fallos van a DLQ para inspección/reproceso manual

**Negativas**:
- El flujo end-to-end se reconstruye solo leyendo logs/traces
- Requiere disciplina de idempotencia en cada handler

**Mitigaciones**:
- X-Ray activo para trace cross-context
- CloudWatch dashboard con flow visualizado manualmente
- Regla global: handler que falla 3 veces → DLQ + alerta

---

