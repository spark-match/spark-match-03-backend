# ADR-011: Idempotencia por eventId en handlers async


**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

EventBridge garantiza *at-least-once* delivery. Un handler async puede recibir el mismo evento dos veces. ¿Cómo evitamos procesamiento duplicado?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Idempotency table (DynamoDB)** | Rápido, TTL automático, sin infra extra | Costo mínimo por escritura |
| Idempotency en BD de dominio | Sin infra extra | Acopla el handler al dominio |
| Sin idempotencia (acepta duplicados) | Simple | Riesgo de emails dobles, métricas infladas |

### Decisión

**Tabla DynamoDB `spark-match-event-idempotency`**:

- Key: `eventId` (partition key)
- TTL: 7 días (suficiente para retries de EventBridge)
- Escritura condicional (`attribute_not_exists`) para evitar race conditions
- Si el `eventId` ya existe → handler retorna 200 sin procesar

### Consecuencias

**Positivas**:
- Procesamiento exactly-once a nivel práctico
- Tabla barata (~$0.01/mes para el volumen del TFP)
- Patrón uniforme para todos los handlers async

**Negativas**:
- Una llamada extra a DynamoDB por evento (~5ms)
- Tabla adicional a gestionar (mínimo: TTL + retention)

**Mitigaciones**:
- Batch writes si el volumen sube
- CloudWatch alarm si `ConsumedWriteCapacityUnits` se dispara (señal de retries masivos)

---

