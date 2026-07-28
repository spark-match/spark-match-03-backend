# ADR-012: Backend híbrido — Lambda (Node/Py) + servidor Python dedicado


**Estado**: Aceptado · **Fecha**: 2026-07-06
**Supersedes**: ADR-001 (parcialmente), alinea con `00-knowledge-base/decisions/ADR-001-backend-hibrido-lambda-mas-agente.md`
**Relacionado**: `08-deep-agent/DEPLOYMENT.md`, `00-knowledge-base/docs/SDD/4_reglas-negocio-agente.md` §8

### Contexto

Existían 2 ADR-001 contradictorios en la organización:

- `03-backend/DECISIONS.md` (este repo) ADR-001: "Lambda para todo el backend"
- `00-knowledge-base/decisions/ADR-001-backend-hibrido-lambda-mas-agente.md` (Fabiola):
  "Híbrido: Lambda (CRUD/EDA) + servidor Python dedicado (agente)"

El segundo es el correcto y se alinea con:
- `08-deep-agent/DEPLOYMENT.md` (587 líneas) que recomienda Bedrock AgentCore Runtime
- `docs/SDD/4_reglas-negocio-agente.md` §8 (Deltas respecto a 2_requirements y 3_design)

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| A. Todo Lambda (ADR-001 original) | Simple, alineado con "low ops" | Streaming incómodo, LangGraph stateful no aplica bien, contradice DEPLOYMENT.md del agente |
| B. Todo servidor tradicional | Streaming natural, LangGraph funciona out-of-the-box | Costo ~$20/mes mínimo, contradice decisión serverless, ops burden |
| **C. Híbrido (recomendado)** | Cada carga en su sitio: Lambda para CRUD/EDA, servidor Python para el agente con streaming | Dos entornos de despliegue que coordinar, dos IaC pipelines |

### Decisión

**Opción C — Backend híbrido con separación física por repo**:

| Componente | Tecnología | Repo |
|---|---|---|
| **Identity, Assessment, Career** | Lambda TypeScript vía SAM | `03-backend` (este repo) |
| **Matching** (afinidad, scoring) | Lambda Python vía SAM | `03-backend` (este repo) |
| **Notifications** (cross-cutting) | Lambda Python/TS vía SAM | `03-backend` (este repo) |
| **AI Advisor / Agente** (chat, RAG, Bedrock) | **Servidor Python FastAPI dedicado** (Bedrock AgentCore Runtime) | **`08-deep-agent`** (repo separado) |

### ¿Por qué el agente va en repo separado?

1. **Bounded Context independiente**: el agente es un contexto cognitivo completo, no un subdominio del backend CRUD.
2. **Streaming natural**: el agente responde token-por-token vía SSE/AG-UI. Lambda puede hacer streaming pero el modelo de invocación es más natural en un servidor long-lived.
3. **LangGraph stateful**: LangGraph mantiene estado de conversación entre turnos vía checkpointer (mejor en proceso persistente).
4. **WebSocket bidireccional**: la UI usa AG-UI protocol bidireccional. Lambda no soporta bien WebSockets nativamente.
5. **Equipo separado**: ahincho (DevOps) + nikolaiasencios (Data) son los dueños naturales del agente, no el equipo de backend CRUD.
6. **Costo predecible**: 1 instancia de AgentCore es comparable a Lambda + API GW WebSocket, pero con menos complejidad.

### ¿Cómo se conecta el agente con el backend?

```
┌────────────┐                  ┌─────────────────────┐
│ Frontend   │                  │  Backend (03)       │
│ 04-frontend│  HTTP CRUD       │  - Identity         │
│  (Angular) │ ──────────────►  │  - Assessment       │
│            │                  │  - Career           │
│            │                  │  - Matching         │
│            │                  │  - Notifications    │
│            │                  └─────────────────────┘
│            │                            ▲
│            │  SSE/AG-UI                 │ comparten
│            │  streaming                 │ Aurora
│            │  + JWT                     │
│            ▼                            │
│  ┌────────────────────────┐            │
│  │ Agente (08-deep-agent) │────────────┘
│  │ - FastAPI              │
│  │ - LangGraph + Bedrock  │
│  │ - RAG sobre catálogo   │
│  │ - AgentCore Runtime    │
│  └────────────────────────┘
```

- Frontend llama a **ambos directamente** (no hay proxy)
- Comparten **mismo JWT secret** (validación distribuida)
- Comparten **mismo Aurora** (el agente lee carreras, perfiles, assessments)
- Comparten **mismo EventBridge bus** (el agente emite `MessageSent`)

### Consecuencias

**Positivas**:
- Costo controlado: CRUD escala a 0, agente dimensionado aparte
- Streaming del agente funciona sin forzar Lambda
- Separación limpia: CRUD/EDA vs cognición
- Equipos con ownership claro: backend-devs vs ai-devs

**Negativas**:
- Dos toolchains / dos despliegues
- Contratos entre ambos mundos deben quedar claros
- CI/CD del agente está fuera de este repo

**Mitigaciones**:
- API Gateway HTTP API v2 como punto único de entrada para el frontend
- JSON Schemas compartidos en `shared/contracts/` (este repo) que el agente también consume
- Documentar interfaz agente ↔ backend en `08-deep-agent/docs/API.md`

---

