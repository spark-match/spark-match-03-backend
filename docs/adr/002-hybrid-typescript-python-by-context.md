# ADR-002: Híbrido TypeScript + Python por contexto


**Estado**: DEPRECADO · **Fecha**: 2026-06-30 · **Deprecado**: 2026-07-28

> **Nota de deprecación (2026-07-28)**: Este ADR ya no aplica. La decisión de mantener `spark-match-03-backend` como **TypeScript-only** se consolidó durante la campaña de dependencias de julio 2026 (PRs #41-#56). El AI Advisor (Python) se aloja en [`spark-match-07-deep-agent`](../spark-match-07-deep-agent/), un repo separado con su propio ADR (ver `00-knowledge-base/decisions/ADR-001-backend-hibrido-lambda-mas-agente.md` que originalmente alineaba este diseño).
>
> El contenido histórico del ADR se preserva a continuación para trazabilidad, pero **no debe usarse como guía de implementación**.

### Contexto (histórico)

Cada Lambda puede escribirse en distintos lenguajes. La pregunta es si homogeneizar (todo TS o todo Python) o mezclar.

### Opciones consideradas (histórico)

| Opción | Pros | Contras |
|---|---|---|
| **Todo TypeScript** | Un solo lenguaje, mismo tooling | Ecosistema AI limitado (LangChain TS es secundario) |
| **Todo Python** | Ecosistema AI nativo | Frontend en Angular no comparte tipos |
| **Híbrido por contexto** | Cada contexto en su lenguaje ideal | Más complejidad operativa |

### Decisión (histórico, ya no vigente)

**Híbrido por contexto**:

- **TypeScript** para: Identity, Assessment, Career (CRUD, validación, auth)
- **Python** para: Matching, AI Advisor (cómputo numérico, Bedrock, embeddings)

### Consecuencias (histórico)

**Positivas**:
- TypeScript comparte tipos con el frontend Angular (Zod schemas → form validators)
- Python usa directamente el SDK de Bedrock, LangChain, pgvector (sin ports inmaduros)
- Cada equipo trabaja con su stack preferido

**Negativas**:
- Dos toolchains (npm + uv/pip)
- Contratos de eventos deben ser agnósticos al lenguaje (justifica ADR-007 JSON Schema)

**Mitigaciones**:
- Lambda Layers separados por runtime (`python-runtime`, `node-runtime`)
- CI matrix por lenguaje

---

