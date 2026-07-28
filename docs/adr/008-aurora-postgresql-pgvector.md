# ADR-008: Aurora PostgreSQL con pgvector


**Estado**: Aceptado (reconsiderado) · **Fecha**: 2026-06-30 · **Reconsiderado**: 2026-07-13

> **Actualización 2026-07-13**: Aurora Serverless v2 sigue siendo la base de datos relacional principal. Sin embargo, **la extensión `pgvector` se descarta**: la búsqueda vectorial se hará en un **proveedor especializado** (a definir en un ADR futuro). Mantenemos la decisión de una sola BD relacional, pero la columna `embeddings` se moverá a un servicio externo de vector store.

### Contexto

Necesitamos almacenar datos relacionales (usuarios, carreras, assessments) + embeddings para RAG. ¿Una sola BD o varias?

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Aurora PG + pgvector** | Una BD, JOINs cross-schema, embeddings en el mismo motor | Requiere disciplina de schemas lógicos |
| Aurora PG + OpenSearch | Lo mejor de cada mundo | Costo ~$100/mes OpenSearch |
| RDS MySQL + Pinecone | MySQL familiar | Vendor externo, datos fuera de AWS |
| DynamoDB + FAISS | Serverless-native | No relacional, JOINs manuales |

### Decisión (original)

**Aurora PostgreSQL Serverless v2** con extensión `pgvector`. Schemas lógicos por contexto (`identity`, `assessment`, `career`, `matching`, `ai`).

### Decisión (revisada 2026-07-13)

**Aurora PostgreSQL Serverless v2** (sin pgvector). Schemas lógicos por contexto (`identity`, `assessment`, `career`, `matching`, `ai`). El vector store será un servicio externo dedicado (TBD en nuevo ADR).

### Consecuencias

**Positivas**:
- Una sola BD que sirve relacional + vectores
- JOINs cross-schema posibles (con moderación, solo para vistas)
- pgvector es open-source, sin vendor lock-in
- Backups, replication gestionados por Aurora

**Negativas**:
- Si un contexto abusa, puede leer/escribir schemas ajenos (mitigado por CODEOWNERS + tests)
- Aurora Serverless v2 tiene mínimo de capacidad (ACU) configurable

**Mitigaciones**:
- CODEOWNERS impide PR cross-schema sin review de los equipos afectados
- Tests automatizados verifican que cada Lambda solo accede a su schema
- GRANTs en Postgres limitan permisos por rol

---

