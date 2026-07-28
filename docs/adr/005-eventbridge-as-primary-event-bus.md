# ADR-005: EventBridge como bus principal de eventos


**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

Necesitamos un bus para comunicación asíncrona entre contextos. Opciones: SNS, SQS, EventBridge, Kafka.

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **EventBridge** | Schema discovery, archive, reglas declarativas | Latencia ~500ms (vs SNS inmediato) |
| SNS | Simple, fan-out rápido | Sin schemas, sin reglas de filtrado |
| SQS | Cola durable, retries | 1-a-1, sin fan-out nativo |
| Kafka (MSK) | Potente, ordenado | Costo elevado, ops complejo |

### Decisión

**EventBridge** como bus principal. Bus custom `spark-match-events`. SQS solo como DLQ de las reglas.

### Consecuencias

**Positivas**:
- Schema discovery automático para nuevos eventos
- Archive (30 días) permite replay para nuevos consumidores
- Reglas filtran por `source`, `detail-type`, contenido del payload
- Integración nativa con CloudWatch metrics

**Negativas**:
- Latencia ligeramente mayor que SNS (aceptable para eventos de dominio)
- Costo: $1/million events (gratis hasta cierto límite)

---

