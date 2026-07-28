# ADR-001: Serverless (Lambda) sobre ECS Fargate


**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

El backend de Spark Match debe servir a una audiencia de tamaño piloto (TFP). La pregunta es si usar compute serverless (Lambda) o contenedores gestionados (ECS Fargate).

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Lambda** | Coste ~0 en baja carga, ops cero, auto-scaling | Cold start 200-400ms, timeout 15min |
| **ECS Fargate** | Sin cold start, contenedor long-lived | Coste mínimo ~$30/mes, requiere gestión |
| EC2 propio | Control total | Alto coste ops, antipatrón para TFP |

### Decisión

**AWS Lambda** para todo el backend.

### Consecuencias

**Positivas**:
- Coste operativo marginal en MVP (free tier cubre los primeros 1M requests/mes)
- Cero gestión de servidores, parches, capacity planning
- Auto-scaling transparente (de 0 a miles de invocaciones concurrentes)
- Pago por uso real

**Negativas**:
- Cold start penaliza la primera request (mitigado con provisioned concurrency si es crítico)
- Timeout de 15 min limita workflows largos (mitigado dividiendo en pasos async)
- Vendor lock-in a AWS (aceptable dado el contexto AWS-first)

**Mitigaciones**:
- **Provisioned Concurrency** solo para Lambdas críticas (chat con Bedrock) si el cold start duele
- Mantener dependencias mínimas (Lambda package <50MB)
- Runtime Node.js 20 / Python 3.12 (cold starts optimizados)

---

