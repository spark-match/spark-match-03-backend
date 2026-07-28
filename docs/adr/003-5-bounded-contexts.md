# ADR-003: 5 Bounded Contexts


**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

El dominio Spark Match tiene varios subdominios. ¿Cuántos contextos definir?

### Opciones consideradas

| # Contextos | Ejemplo | Trade-off |
|---|---|---|
| 3 | Identity+Profile, Assessment+Matching, AI Advisor | Simple, pero contextos se vuelven "mini-monolitos" |
| **5** | Identity, Assessment, Career, Matching, AI Advisor | Balance claridad/complejidad |
| 8 | Separar RAG, Notif, Analytics como contextos | Más puro DDD, excesivo para TFP |

### Decisión

**5 contextos principales** + Notifications como contexto cross-cutting (event handlers puros, sin API).

### Consecuencias

**Positivas**:
- Cada contexto cabe en la cabeza de un dev (~2-3 Lambdas)
- Lenguaje ubicuo claro por contexto
- Deploys independientes viables

**Negativas**:
- Más boilerplate inicial (5 carpetas `contexts/`, 5 dominios)
- Notificaciones distribuidas entre varios contextos si se necesita UI

**Mitigaciones**:
- Templates SAM por contexto que se importan al template principal
- Notifications UI se implementa como vista agregada que lee DynamoDB

---

