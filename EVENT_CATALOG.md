# Catálogo de Eventos de Dominio

> Single source of truth para los eventos que cruzan contextos.
> Versión actual del bus: **v1**. Cualquier cambio incompatible → nuevo `version` field.

## 1. Convenciones

### 1.1 Naming

| Tipo | Convención | Ejemplo |
|---|---|---|
| Domain Event | PascalCase, pasado | `UserRegistered` |
| Command (interno) | PascalCase, imperativo | `RegisterUser` |
| Integration Event | Prefijo `Integration` | `IntegrationCareerUpdated` |

### 1.2 Estructura estándar (envelope EventBridge)

Todos los eventos siguen este envelope:

```json
{
  "version": "0",
  "id": "uuid-v4",
  "detail-type": "UserRegistered",
  "source": "spark-match.identity",
  "account": "681526276858",
  "time": "2026-06-30T12:34:56.789Z",
  "region": "us-east-1",
  "resources": [],
  "detail": {
    "version": 1,
    "data": { /* payload específico del evento */ }
  }
}
```

Campos del `detail`:

- `version`: schema version (entero, empieza en 1)
- `data`: payload del evento (validado contra JSON Schema en `shared/contracts/`)

### 1.3 Versionado

- **Backward compatible** (añadir campo opcional) → mismo `version`, sin breaking change
- **Breaking change** (renombrar/quitar/cambiar tipo) → bump `version` + crear nueva entrada en `EVENT_CATALOG.md`
- Consumidores deben ignorar campos desconocidos (tolerancia)

### 1.4 Source naming

`spark-match.<context>`:

| Source | Contexto |
|---|---|
| `spark-match.identity` | Identity |
| `spark-match.assessment` | Assessment |
| `spark-match.career` | Career |
| `spark-match.matching` | Matching |
| `spark-match.ai` | AI Advisor |

## 2. Eventos v1

### 2.1 UserRegistered

**Producido por**: Identity Context
**Consumidores**: Notifications (welcome email), Analytics

**Trigger**: `POST /v1/auth/register` completado exitosamente.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://spark-match/schemas/events/user-registered.v1.json",
  "title": "UserRegistered",
  "type": "object",
  "required": ["version", "data"],
  "properties": {
    "version": { "const": 1 },
    "data": {
      "type": "object",
      "required": ["userId", "email", "registeredAt", "profileCompleted"],
      "properties": {
        "userId": { "type": "string", "format": "uuid" },
        "email": { "type": "string", "format": "email" },
        "displayName": { "type": "string", "minLength": 1, "maxLength": 100 },
        "registeredAt": { "type": "string", "format": "date-time" },
        "profileCompleted": { "type": "boolean" },
        "locale": { "type": "string", "enum": ["es-PE", "en-US"] }
      },
      "additionalProperties": false
    }
  }
}
```

---

### 2.2 ProfileUpdated

**Producido por**: Identity Context
**Consumidores**: Matching (invalidar cache), AI Advisor (re-prompt)

**Trigger**: `PATCH /v1/users/me` con cambios en el perfil.

```json
{
  "$id": "https://spark-match/schemas/events/profile-updated.v1.json",
  "title": "ProfileUpdated",
  "type": "object",
  "required": ["version", "data"],
  "properties": {
    "version": { "const": 1 },
    "data": {
      "type": "object",
      "required": ["userId", "updatedAt", "changedFields"],
      "properties": {
        "userId": { "type": "string", "format": "uuid" },
        "updatedAt": { "type": "string", "format": "date-time" },
        "changedFields": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["displayName", "bio", "interests", "educationLevel", "locale"]
          },
          "minItems": 1
        },
        "snapshot": {
          "type": "object",
          "description": "Snapshot parcial del perfil post-update (solo campos cambiados)",
          "properties": {
            "displayName": { "type": "string" },
            "bio": { "type": "string" },
            "interests": { "type": "array", "items": { "type": "string" } },
            "educationLevel": {
              "type": "string",
              "enum": ["secondary", "technical", "university-incomplete", "university-complete", "postgraduate"]
            },
            "locale": { "type": "string" }
          }
        }
      }
    }
  }
}
```

---

### 2.3 AssessmentStarted

**Producido por**: Assessment Context
**Consumidores**: Analytics

**Trigger**: `POST /v1/assessments` crea una nueva evaluación.

```json
{
  "$id": "https://spark-match/schemas/events/assessment-started.v1.json",
  "title": "AssessmentStarted",
  "type": "object",
  "required": ["version", "data"],
  "properties": {
    "version": { "const": 1 },
    "data": {
      "type": "object",
      "required": ["assessmentId", "userId", "assessmentType", "startedAt"],
      "properties": {
        "assessmentId": { "type": "string", "format": "uuid" },
        "userId": { "type": "string", "format": "uuid" },
        "assessmentType": {
          "type": "string",
          "enum": ["riasec", "big-five", "vocational-interests"]
        },
        "startedAt": { "type": "string", "format": "date-time" },
        "totalQuestions": { "type": "integer", "minimum": 1 }
      }
    }
  }
}
```

---

### 2.4 AssessmentCompleted

**Producido por**: Assessment Context
**Consumidores**: **Matching** (calcular recomendaciones), Analytics

**Trigger**: última respuesta de una evaluación registrada, resultado calculado.

```json
{
  "$id": "https://spark-match/schemas/events/assessment-completed.v1.json",
  "title": "AssessmentCompleted",
  "type": "object",
  "required": ["version", "data"],
  "properties": {
    "version": { "const": 1 },
    "data": {
      "type": "object",
      "required": ["assessmentId", "userId", "assessmentType", "completedAt", "result"],
      "properties": {
        "assessmentId": { "type": "string", "format": "uuid" },
        "userId": { "type": "string", "format": "uuid" },
        "assessmentType": {
          "type": "string",
          "enum": ["riasec", "big-five", "vocational-interests"]
        },
        "completedAt": { "type": "string", "format": "date-time" },
        "durationSeconds": { "type": "integer", "minimum": 0 },
        "result": {
          "type": "object",
          "description": "Resultado normalizado del assessment (estructura varía por tipo)",
          "properties": {
            "riasec": {
              "type": "object",
              "properties": {
                "R": { "type": "number", "minimum": 0, "maximum": 100 },
                "I": { "type": "number", "minimum": 0, "maximum": 100 },
                "A": { "type": "number", "minimum": 0, "maximum": 100 },
                "S": { "type": "number", "minimum": 0, "maximum": 100 },
                "E": { "type": "number", "minimum": 0, "maximum": 100 },
                "C": { "type": "number", "minimum": 0, "maximum": 100 }
              }
            },
            "bigFive": {
              "type": "object",
              "properties": {
                "openness": { "type": "number", "minimum": 0, "maximum": 100 },
                "conscientiousness": { "type": "number", "minimum": 0, "maximum": 100 },
                "extraversion": { "type": "number", "minimum": 0, "maximum": 100 },
                "agreeableness": { "type": "number", "minimum": 0, "maximum": 100 },
                "neuroticism": { "type": "number", "minimum": 0, "maximum": 100 }
              }
            }
          }
        }
      }
    }
  }
}
```

---

### 2.5 CareerCreated

**Producido por**: Career Context
**Consumidores**: **AI Advisor** (reindex RAG), Matching (incorporar al scoring)

**Trigger**: admin crea nueva carrera vía panel o seed script.

```json
{
  "$id": "https://spark-match/schemas/events/career-created.v1.json",
  "title": "CareerCreated",
  "type": "object",
  "required": ["version", "data"],
  "properties": {
    "version": { "const": 1 },
    "data": {
      "type": "object",
      "required": ["careerId", "name", "category", "createdAt"],
      "properties": {
        "careerId": { "type": "string", "format": "uuid" },
        "name": { "type": "string", "minLength": 1, "maxLength": 200 },
        "category": { "type": "string", "maxLength": 100 },
        "description": { "type": "string", "maxLength": 2000 },
        "riasecProfile": {
          "type": "object",
          "description": "Pesos RIASEC ideales para esta carrera (0-1)",
          "properties": {
            "R": { "type": "number", "minimum": 0, "maximum": 1 },
            "I": { "type": "number", "minimum": 0, "maximum": 1 },
            "A": { "type": "number", "minimum": 0, "maximum": 1 },
            "S": { "type": "number", "minimum": 0, "maximum": 1 },
            "E": { "type": "number", "minimum": 0, "maximum": 1 },
            "C": { "type": "number", "minimum": 0, "maximum": 1 }
          }
        },
        "skills": {
          "type": "array",
          "items": { "type": "string" }
        },
        "createdAt": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

---

### 2.6 CareerUpdated

**Producido por**: Career Context
**Consumidores**: **AI Advisor** (reindex RAG), Matching (recalcular scores)

**Trigger**: admin actualiza una carrera existente.

```json
{
  "$id": "https://spark-match/schemas/events/career-updated.v1.json",
  "title": "CareerUpdated",
  "type": "object",
  "required": ["version", "data"],
  "properties": {
    "version": { "const": 1 },
    "data": {
      "type": "object",
      "required": ["careerId", "updatedAt", "changedFields"],
      "properties": {
        "careerId": { "type": "string", "format": "uuid" },
        "updatedAt": { "type": "string", "format": "date-time" },
        "changedFields": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["name", "category", "description", "riasecProfile", "skills"]
          }
        },
        "snapshot": {
          "type": "object",
          "description": "Snapshot parcial post-update"
        }
      }
    }
  }
}
```

---

### 2.7 RecommendationGenerated

**Producido por**: Matching Context
**Consumidores**: **Notifications** (email), Analytics

**Trigger**: matching engine calcula recomendaciones para un usuario.

```json
{
  "$id": "https://spark-match/schemas/events/recommendation-generated.v1.json",
  "title": "RecommendationGenerated",
  "type": "object",
  "required": ["version", "data"],
  "properties": {
    "version": { "const": 1 },
    "data": {
      "type": "object",
      "required": ["userId", "generatedAt", "recommendations"],
      "properties": {
        "userId": { "type": "string", "format": "uuid" },
        "generatedAt": { "type": "string", "format": "date-time" },
        "trigger": {
          "type": "string",
          "enum": ["assessment-completed", "profile-updated", "manual-request"]
        },
        "recommendations": {
          "type": "array",
          "minItems": 1,
          "maxItems": 10,
          "items": {
            "type": "object",
            "required": ["careerId", "affinityScore", "rank"],
            "properties": {
              "careerId": { "type": "string", "format": "uuid" },
              "careerName": { "type": "string" },
              "affinityScore": { "type": "number", "minimum": 0, "maximum": 1 },
              "rank": { "type": "integer", "minimum": 1, "maximum": 10 },
              "reasons": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Breves razones en lenguaje natural (para mostrar al usuario)"
              }
            }
          }
        }
      }
    }
  }
}
```

---

### 2.8 MessageSent

**Producido por**: AI Advisor Context
**Consumidores**: Analytics, conversation-log

**Trigger**: usuario o asistente envía mensaje en una conversación.

```json
{
  "$id": "https://spark-match/schemas/events/message-sent.v1.json",
  "title": "MessageSent",
  "type": "object",
  "required": ["version", "data"],
  "properties": {
    "version": { "const": 1 },
    "data": {
      "type": "object",
      "required": ["conversationId", "messageId", "role", "content", "sentAt"],
      "properties": {
        "conversationId": { "type": "string", "format": "uuid" },
        "messageId": { "type": "string", "format": "uuid" },
        "userId": { "type": "string", "format": "uuid" },
        "role": {
          "type": "string",
          "enum": ["user", "assistant", "system"]
        },
        "contentLength": { "type": "integer", "minimum": 0 },
        "usedRag": { "type": "boolean", "description": "Si el assistant usó contexto RAG" },
        "modelId": {
          "type": "string",
          "description": "Bedrock model usado (ej: anthropic.claude-3-haiku-20240307-v1:0)"
        },
        "inputTokens": { "type": "integer", "minimum": 0 },
        "outputTokens": { "type": "integer", "minimum": 0 },
        "sentAt": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

---

### 2.9 KnowledgeDocIngested

**Producido por**: AI Advisor Context
**Consumidores**: Matching (opcional, si el doc afecta scoring)

**Trigger**: documento añadido al knowledge base de RAG.

```json
{
  "$id": "https://spark-match/schemas/events/knowledge-doc-ingested.v1.json",
  "title": "KnowledgeDocIngested",
  "type": "object",
  "required": ["version", "data"],
  "properties": {
    "version": { "const": 1 },
    "data": {
      "type": "object",
      "required": ["documentId", "source", "ingestedAt", "chunkCount"],
      "properties": {
        "documentId": { "type": "string", "format": "uuid" },
        "source": {
          "type": "string",
          "enum": ["career-description", "external-resource", "user-uploaded"]
        },
        "relatedCareerId": { "type": "string", "format": "uuid" },
        "ingestedAt": { "type": "string", "format": "date-time" },
        "chunkCount": { "type": "integer", "minimum": 1 },
        "s3Location": { "type": "string", "description": "s3://bucket/key del documento original" }
      }
    }
  }
}
```

## 3. Matriz productor ↔ consumidor

| Evento | Identity | Assessment | Career | Matching | AI Advisor | Notifications |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `UserRegistered` | 🟢 P | | | | | 🔵 C |
| `ProfileUpdated` | 🟢 P | | | 🔵 C | 🔵 C | |
| `AssessmentStarted` | | 🟢 P | | | | |
| `AssessmentCompleted` | | 🟢 P | | 🔵 C | | 🔵 C |
| `CareerCreated` | | | 🟢 P | 🔵 C | 🔵 C | |
| `CareerUpdated` | | | 🟢 P | 🔵 C | 🔵 C | |
| `RecommendationGenerated` | | | | 🟢 P | | 🔵 C |
| `MessageSent` | | | | | 🟢 P | |
| `KnowledgeDocIngested` | | | | | 🟢 P | |

🟢 P = Productor | 🔵 C = Consumidor

## 4. Versionado histórico

| Evento | v1 publicado | Notas |
|---|---|---|
| `UserRegistered` | 2026-06-30 | Versión inicial |
| `ProfileUpdated` | 2026-06-30 | Versión inicial |
| `AssessmentStarted` | 2026-06-30 | Versión inicial |
| `AssessmentCompleted` | 2026-06-30 | Soporta RIASEC + Big Five |
| `CareerCreated` | 2026-06-30 | Versión inicial |
| `CareerUpdated` | 2026-06-30 | Versión inicial |
| `RecommendationGenerated` | 2026-06-30 | Top-N configurable (default 5) |
| `MessageSent` | 2026-06-30 | Métricas de tokens para cost tracking |
| `KnowledgeDocIngested` | 2026-06-30 | Versión inicial |

## 5. Próximos eventos a documentar (backlog)

- `MatchingFailed` — cuando el engine no puede generar recomendaciones
- `ConversationStarted` — para analytics de engagement
- `UserDeleted` — GDPR / right to be forgotten (cascade cleanup)
- `RecommendationFeedback` — usuario marca like/dislike de recomendación