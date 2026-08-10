-- =============================================================================
-- 006_create_reports_schema_and_orientation_report.sql
-- =============================================================================
-- Creates the `reports` schema and `reports.orientation_report`, the row that
-- ADR-019 D3 describes: the backend is a registry and a proxy, so it stores
-- **bucket + key + version_id**, never a URL. A presigned URL expires (broken
-- row) and one that does not is a permanent capability over a minor's
-- psychometric profile.
--
-- Mirrors the `Database` type in
--   contexts/reports/src/infra/database.ts
-- and the `OrientationReport` domain model in
--   contexts/reports/src/domain/orientation-report.ts
--
--
-- WHY ALMOST EVERY COLUMN IS NULLABLE, AND WHY THAT IS NOT SLOPPY
--
-- A row is born `pending` (ADR-019 D4: `POST /v1/reports` returns 202 and the
-- frontend polls). At that instant nothing about the report exists yet -- no
-- objects, no RIASEC code, no dataset date -- because it has not been
-- generated. Declaring those columns NOT NULL would make the pending state
-- unrepresentable, and the usual workaround is worse: inserting empty strings
-- and zeroes that later become indistinguishable from real values.
--
-- So the columns are nullable and the invariant is expressed where it is
-- actually true: `report_ready_is_complete` below. A row may be incomplete
-- while it is `pending` or `failed`; the moment it claims to be `ready`, the
-- database requires everything a reader needs. "Ready" cannot lie.
--
--
-- WHY `objects` IS JSONB AND NOT EIGHT COLUMNS
--
-- Each report is two S3 objects: the `.json` (the source of truth, from which
-- the PDF can be re-rendered without paying for the model again) and the
-- `.pdf` (what the student downloads). Each carries its own key, version_id,
-- size and checksum -- eight columns if flattened.
--
-- The shape lives in one JSONB column instead. The trade-off is real and is
-- accepted deliberately: Postgres will not type-check what goes in, so the
-- shape is enforced in the application (see `parseReportObjects`). What the
-- database still guarantees is the part that would hurt most if it broke --
-- that a `ready` report has both objects present, checked below. A row that
-- says "ready" with no PDF would send a student to a download that 404s.
--
--
-- WHY ONE PENDING REPORT PER STUDENT, ENFORCED HERE
--
-- Two doors can start a report: the student pressing the button (backend) and
-- the agent's chat tool. Two doors writing one table is the two-tabs defect
-- again -- the one already fixed inside the agent for conversation turns --
-- and the cheapest place to close it is not the application, it is a partial
-- unique index. Whichever door gets there second gets a constraint violation
-- instead of a second row, with no coordination between the two services and
-- no race window to reason about.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS reports;

COMMENT ON SCHEMA reports IS 'Spark Match: Reports bounded context (orientation reports).';

CREATE TABLE reports.orientation_report (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID         NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT current_timestamp,
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT current_timestamp,
  status                VARCHAR(16)  NOT NULL DEFAULT 'pending',

  -- Donde esta el objeto. La key, nunca la URL (D3).
  s3_bucket             TEXT         NULL,
  objects               JSONB        NULL,

  -- Resumen para listar sin abrir el objeto.
  schema_version        TEXT         NULL,
  riasec_code           VARCHAR(3)   NULL,
  profile_completeness  NUMERIC(4,3) NULL,
  top_careers           JSONB        NULL,

  -- Procedencia: a que corte de datos queda atado este informe (D2).
  dataset_source        TEXT         NULL,
  dataset_snapshot_date DATE         NULL,

  -- Como se genero.
  model_id              TEXT         NULL,
  langsmith_run_id      UUID         NULL,
  generation_ms         INTEGER      NULL,
  failure_reason        TEXT         NULL,

  CONSTRAINT orientation_report_status_check
    CHECK (status IN ('pending', 'ready', 'failed')),

  -- Un informe `ready` esta completo o no es `ready`.
  CONSTRAINT orientation_report_ready_is_complete
    CHECK (
      status <> 'ready' OR (
        s3_bucket IS NOT NULL
        AND objects IS NOT NULL
        AND schema_version IS NOT NULL
        AND riasec_code IS NOT NULL
        AND top_careers IS NOT NULL
        AND dataset_source IS NOT NULL
        AND dataset_snapshot_date IS NOT NULL
      )
    ),

  -- `profile_completeness` NO esta en la lista de arriba a proposito: se
  -- rellena cuando exista quien lo aporte (fase 5, PR 5), y hasta entonces
  -- exigirlo dejaria imposible cerrar un informe correcto.

  -- Y uno `failed` dice por que. Un fallo sin motivo obliga a mirar los logs
  -- de una generacion que ocurrio hace semanas.
  CONSTRAINT orientation_report_failed_says_why
    CHECK (status <> 'failed' OR failure_reason IS NOT NULL),

  -- Lo minimo que la base de datos SI puede comprobar de `objects`: que es un
  -- objeto y que trae los dos. El resto de la forma la valida la aplicacion.
  --
  -- `jsonb_exists(x, 'k')` y no `x ? 'k'`, que es el mismo operador escrito
  -- corto: el `?` es tambien el marcador de parametro de unos cuantos drivers,
  -- y este fichero lo van a ejecutar tanto la Lambda de migracion como quien
  -- lo abra a mano en un cliente de SQL. La forma de funcion no depende de
  -- quien lo lea.
  CONSTRAINT orientation_report_objects_shape
    CHECK (
      objects IS NULL OR (
        jsonb_typeof(objects) = 'object'
        AND jsonb_exists(objects, 'json')
        AND jsonb_exists(objects, 'pdf')
      )
    ),

  CONSTRAINT orientation_report_top_careers_is_array
    CHECK (top_careers IS NULL OR jsonb_typeof(top_careers) = 'array'),

  CONSTRAINT orientation_report_completeness_range
    CHECK (profile_completeness IS NULL OR profile_completeness BETWEEN 0 AND 1)
);

COMMENT ON TABLE  reports.orientation_report                       IS 'Spark Match reports context: un informe de orientacion por fila. El contenido vive en S3; esto es el registro (ADR-019, D3).';
COMMENT ON COLUMN reports.orientation_report.id                    IS 'Identificador del informe (UUID). Es parte de la key en S3, por eso es opaco.';
COMMENT ON COLUMN reports.orientation_report.user_id               IS 'Dueño del informe. ON DELETE CASCADE: borrar la cuenta borra sus informes.';
COMMENT ON COLUMN reports.orientation_report.created_at            IS 'Cuando se pidio el informe, no cuando quedo listo.';
COMMENT ON COLUMN reports.orientation_report.updated_at            IS 'Ultimo cambio de estado. Lo mantiene un trigger.';
COMMENT ON COLUMN reports.orientation_report.status                IS 'pending | ready | failed. Nace pending (D4); ready obliga a estar completo.';
COMMENT ON COLUMN reports.orientation_report.s3_bucket             IS 'Bucket que contiene los dos objetos. Se guarda el nombre, no una URL.';
COMMENT ON COLUMN reports.orientation_report.objects               IS 'Mapa {json, pdf}, cada uno con key, versionId, sizeBytes y checksumSha256. La forma la valida la aplicacion.';
COMMENT ON COLUMN reports.orientation_report.schema_version        IS 'Version de la forma del JSON guardado. Permite releer informes viejos.';
COMMENT ON COLUMN reports.orientation_report.riasec_code           IS 'Codigo Holland de 3 letras. Resumen para listar sin abrir el objeto.';
COMMENT ON COLUMN reports.orientation_report.profile_completeness  IS 'Que tan completo estaba el perfil vocacional al emitirlo, 0 a 1.';
COMMENT ON COLUMN reports.orientation_report.top_careers           IS 'Nombres de las carreras recomendadas, en orden. Nombres y no ids: asi se identifican las carreras del portal.';
COMMENT ON COLUMN reports.orientation_report.dataset_source        IS 'Catalogo de origen, sin fecha. Ej. "Ponte en Carrera (MINEDU)".';
COMMENT ON COLUMN reports.orientation_report.dataset_snapshot_date IS 'Corte de datos con el que se genero. Ata el informe a su version de datos (D2).';
COMMENT ON COLUMN reports.orientation_report.model_id              IS 'Modelo que escribio la prosa del informe.';
COMMENT ON COLUMN reports.orientation_report.langsmith_run_id      IS 'Traza de la generacion (D10). Puede caducar antes que el informe.';
COMMENT ON COLUMN reports.orientation_report.generation_ms         IS 'Cuanto tardo en generarse, en milisegundos.';
COMMENT ON COLUMN reports.orientation_report.failure_reason        IS 'Por que fallo. Obligatorio cuando status = failed.';

-- Listar los informes de un estudiante, del mas nuevo al mas viejo. Es la
-- unica consulta que hace la pantalla de informes.
CREATE INDEX reports_orientation_report_user_created_idx
  ON reports.orientation_report (user_id, created_at DESC);

-- Una sola generacion en curso por estudiante. Cierra las dos puertas contra
-- la base de datos en vez de contra un acuerdo entre dos servicios.
CREATE UNIQUE INDEX reports_orientation_report_one_pending_per_user
  ON reports.orientation_report (user_id)
  WHERE status = 'pending';

-- Mismo trigger que identity.users, en el schema de este contexto: cada
-- contexto es dueño de lo suyo y no depende de una funcion de otro schema.
CREATE OR REPLACE FUNCTION reports.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = current_timestamp;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orientation_report_touch_updated_at
  BEFORE UPDATE ON reports.orientation_report
  FOR EACH ROW
  EXECUTE FUNCTION reports.touch_updated_at();
