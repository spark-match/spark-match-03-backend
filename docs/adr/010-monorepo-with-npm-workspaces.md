# ADR-010: Monorepo con npm workspaces


**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

5 bounded contexts + shared kernel + tests. ¿Un repo o varios?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Monorepo con workspaces** | Tipos compartidos, contratos sincronizados, un deploy | Repo crece, requiere CI inteligente |
| Polyrepo (uno por contexto) | Aislamiento total, deploys independientes | N repos que coordinar, refactor cross-context imposible |
| Monorepo sin workspaces | Más simple | No resuelve compartir tipos |

### Decisión

**Monorepo único** (`spark-match-03-backend`) con **npm workspaces** para TypeScript (único lenguaje en este repo). Estructura:

```
03-backend/
├── shared/           # @spark-match/shared (npm workspace)
├── contexts/         # Bounded contexts (TypeScript)
├── layers/           # Lambda layers (node-runtime)
├── migrations/       # SQL files
└── tests/
```

### Consecuencias

**Positivas**:
- Contratos de eventos (`shared/contracts/`) evolucionan atómicamente
- Tipos compartidos entre contextos vía workspaces (`@spark-match/shared`)
- Un solo `sam deploy` para todo
- CI corre tests de todos los contextos en paralelo

**Negativas**:
- Repo puede crecer (mitigado: layers se cachean, tests en CI son incrementales)
- Un PR puede tocar múltiples contextos (mitigado: CODEOWNERS notifica a cada equipo)

---

