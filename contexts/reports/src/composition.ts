// =============================================================================
// Reports composition root
// =============================================================================
// Lazy singleton shared by every handler in the reports context, same shape as
// contexts/identity/src/composition.ts.
//
// Smaller than identity's on purpose: no EventBridge publisher and no JWT
// signer. This context does not emit events yet and does not mint tokens -- it
// only verifies the ones identity mints, which `buildHandler` already does.
// =============================================================================

import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import type { Kysely } from 'kysely';
import { getDbConnection } from './infra/db-connection.js';
import {
  createOrientationReportRepository,
  type Database,
  type OrientationReportRepository,
} from './infra/orientation-report-repository.js';
import { createReportObjectStore, type ReportObjectStore } from './infra/report-object-store.js';
import { createReportsConfig, type ReportsConfig } from './infra/reports-config.js';
import { createReportService, type ReportService } from './service/report-service.js';

export interface ReportsContext {
  logger: ReturnType<typeof createLogger>;
  tracer: Tracer;
  db: Kysely<Database>;
  reportRepository: OrientationReportRepository;
  reportObjectStore: ReportObjectStore;
  reportsConfig: ReportsConfig;
  reportService: ReportService;
}

let context: ReportsContext | null = null;
let pendingPromise: Promise<ReportsContext> | null = null;

export async function buildContext(): Promise<ReportsContext> {
  if (context) return context;
  if (pendingPromise) return pendingPromise;

  pendingPromise = (async () => {
    const logger = createLogger('reports');
    const tracer = new Tracer({ serviceName: 'reports' });

    const db = await getDbConnection();
    const reportRepository = createOrientationReportRepository(db);
    // Sin `await`: construir el cliente de S3 no hace ninguna llamada de red,
    // asi que no tiene sentido pagarlo en el arranque en frio como la conexion.
    const reportObjectStore = createReportObjectStore();
    // Tampoco lleva `await`, y por un motivo distinto al del store: aqui SI
    // hay llamadas de red, pero van dentro de los metodos. Resolverlas en el
    // arranque congelaria los dos parametros durante toda la vida del
    // contenedor -- ver la cabecera de reports-config.ts.
    const reportsConfig = createReportsConfig();
    const reportService = createReportService({
      reportRepository,
      reportObjectStore,
      reportsConfig,
      logger,
    });

    const built: ReportsContext = {
      logger,
      tracer,
      db,
      reportRepository,
      reportObjectStore,
      reportsConfig,
      reportService,
    };
    context = built;
    return built;
  })();
  return pendingPromise;
}
