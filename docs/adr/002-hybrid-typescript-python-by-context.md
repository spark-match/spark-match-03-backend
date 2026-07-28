# ADR-002: Híbrido TypeScript + Python por contexto


**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

Cada Lambda puede escribirse en distintos lenguajes. La pregunta es si homogeneizar (todo TS o todo Python) o mezclar.

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Todo TypeScript** | Un solo lenguaje, mismo tooling | Ecosistema AI limitado (LangChain TS es secundario) |
| **Todo Python** | Ecosistema AI nativo | Frontend en Angular no comparte tipos |
| **Híbrido por contexto** | Cada contexto en su lenguaje ideal | Más complejidad operativa |

### Decisión

**Híbrido por contexto**:

- **TypeScript** para: Identity, Assessment, Career (CRUD, validación, auth)
- **Python** para: Matching, AI Advisor (cómputo numérico, Bedrock, embeddings)

### Consecuencias

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

