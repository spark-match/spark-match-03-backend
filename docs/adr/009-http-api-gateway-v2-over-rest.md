# ADR-009: HTTP API Gateway v2 sobre REST API


**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

API Gateway tiene dos versiones: REST (v1) y HTTP (v2). ¿Cuál usar?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **HTTP API v2** | $1/M requests, JWT nativo, menor latencia | Menos features (no usage plans, no API keys granulares) |
| REST API v1 | Features completas (throttling, usage plans, caching) | $3.50/M requests, mayor latencia |

### Decisión

**HTTP API v2** para todo el tráfico público. REST API solo si en el futuro se necesita API keys por partner.

### Consecuencias

**Positivas**:
- Coste 3.5x menor en tráfico alto
- Latencia ~10ms menor por request
- JWT authorizer nativo (integra con Cognito o Lambda authorizer)
- CORS más simple

**Negativas**:
- Sin API keys built-in (mitigable con Lambda authorizer custom)
- Sin usage plans (no necesario para TFP)

---

