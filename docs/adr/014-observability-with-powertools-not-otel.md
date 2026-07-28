# ADR-014: Observabilidad con Powertools (NO OpenTelemetry)


**Estado**: Aceptado · **Fecha**: 2026-07-06
**Relacionado**: `D:\UNI\Spark\BACKEND.md` (Decisión 8), `docs/OBSERVABILITY.md`

### Contexto

Spark Match necesita observabilidad end-to-end (logs + traces + metrics) en sus Lambdas.
Decisión entre la librería oficial de AWS (Lambda Powertools) vs el estándar CNCF (OpenTelemetry).

### Opciones consideradas

| Aspecto | **AWS Lambda Powertools** | **OpenTelemetry (OTel)** |
|---|---|---|
| Mantenedor | AWS (oficial) | CNCF (vendor-neutral) |
| Estandarización | AWS-native | Estándar OTel (CNCF) |
| Cloud focus | Solo AWS | Multi-cloud |
| Bundle size | ~50KB - 200KB | ~500KB - 1MB |
| Cold start | +5-15ms | +30-80ms |
| Métricas custom | EMF (gratis) | PutMetricData ($$) o backend externo |
| Idempotencia built-in | ✅ Sí | ❌ No |
| Vendor lock-in | AWS | Ninguno |

### Decisión

**Powertools** por:

1. **AWS-only** (decidido en ADR-001)
2. **Equipo de 5** (OTel Collector es over-engineering)
3. **Bajo tráfico** (free tiers cubren 100% del TFP)
4. **Costo predecible** ($0-6/mes vs $15-50/mes con OTel + Collector)
5. **Bundle size** (4x más pequeño)
6. **Powertools Idempotency** específico para Lambda
7. **AWS-made** (se actualiza primero ante cambios de AWS)

### Consecuencias

**Positivas**:
- ~$0-6/mes en observabilidad completa (logs + traces + metrics)
- Traces con X-Ray (gratis los primeros 100K/mes)
- Métricas con EMF (gratis, sin PutMetricData API)
- Idempotencia con DynamoDB persistence layer built-in

**Negativas**:
- Lock-in a AWS (pero ya decidido)
- Si el día de mañana necesitan Datadog/Honeycomb, hay que migrar a OTel

**Mitigaciones**:
- Powertools y OTel exponen APIs similares, la migración es factible
- Documentar la decisión en `docs/OBSERVABILITY.md` para que sea fácil revertir

### Cuándo reconsiderar

- Spark Match crece a +100K MAU
- Compliance que prohíbe AWS lock-in
- Necesidad de tracing cross-cloud
- Ya pagan Datadog/New Relic

---

## Plantilla para nuevas ADRs

```markdown
## ADR-NNN: Título corto

**Estado**: Propuesto | Aceptado | Deprecado | Superseded by ADR-XXX
**Fecha**: YYYY-MM-DD

### Contexto

[Qué problema estamos resolviendo. 1-3 párrafos.]

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| ... | ... | ... |

### Decisión

[Qué elegimos. 1-2 oraciones.]

### Consecuencias

**Positivas**: ...

**Negativas**: ...

**Mitigaciones**: ...
```