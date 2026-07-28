# ADR-007: JSON Schema como contratos de eventos


**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

Productores y consumidores hablan lenguajes diferentes (TS vs Py). ¿Cómo garantizamos que el payload es válido?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **JSON Schema + ajv/jsonschema** | Agnóstico al lenguaje, ecosistema maduro | Verbosos, dos librerías a mantener |
| TypeScript types + Pydantic | Tipado en cada lado | Productor/consumidor pueden divergir silenciosamente |
| AWS EventBridge Schema Registry | Menos código, auto-descubrimiento | Acopla más a AWS |
| Protobuf | Compacto, tipado | Requiere generadores, overkill para JSON |

### Decisión

**JSON Schema draft-07** en `shared/contracts/<context>/<event>.v<N>.json`. Validación con `ajv` (TS) y `jsonschema` (Py) en cada handler antes de procesar.

### Consecuencias

**Positivas**:
- Una sola fuente de verdad del contrato
- Validación en runtime detecta drift entre productor y consumidor
- Versionado explícito (`v1`, `v2`)
- Schemas publicables para consumidores externos

**Negativas**:
- Overhead de parsear y validar en cada handler (~ms)
- Mantenimiento: añadir campo → actualizar schema + versión si breaking

---

