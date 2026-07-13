# Observabilidad — Spark Match Backend

> **Stack**: AWS Lambda Powertools (Logger + Tracer + Metrics + Parameters + Idempotency)
> **Backend storage**: CloudWatch Logs + X-Ray + CloudWatch Metrics (EMF)
> **Costo mensual estimado**: $0.05 (TFP) - $6.00 (1M invocations)

## 📊 Resumen ejecutivo

Spark Match usa **AWS Lambda Powertools** (librería oficial de AWS) para toda la observabilidad.
NO usamos OpenTelemetry (decisión documentada en ADR-014).

| Utilidad Powertools | Reemplaza a... | Costo |
|---|---|---|
| **Logger** | console.log + JSON.stringify manual | $0.50/GB ingest (CloudWatch Logs) |
| **Tracer** | AWS X-Ray manual SDK calls | $5/M traces (después de 100K gratis/mes) |
| **Metrics** | CloudWatch PutMetricData API ($0.30/metric-mes) | **GRATIS** (formato EMF) |
| **Parameters** | SSM GetParameter manual con caché casero | $0 (mismas llamadas SSM) |
| **Idempotency** | Tabla DynamoDB manual + check de eventId | $0.01/mes (DynamoDB on-demand) |

**Costo total estimado de observabilidad**:
- **TFP (50K invocations/mes)**: ~$0.05/mes
- **Producción temprana (1M invocations/mes)**: ~$6.00/mes
- **Crecimiento serio (10M invocations/mes)**: ~$55/mes

Comparado con soluciones enterprise (Datadog, New Relic): **10-100x más barato** para Spark Match.

## 🔧 Logger

### Configuración estándar

```typescript
// shared/src/logger/powertools-logger.ts
import { Logger } from '@aws-lambda-powertools/logger';

export function createLogger(serviceName: string): Logger {
  return new Logger({
    serviceName,
    logLevel: (process.env.LOG_LEVEL as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') || 'INFO',
    environment: process.env.ENVIRONMENT,
  });
}
```

### Uso en handlers

```typescript
const logger = createLogger('identity-register');

logger.info('User registered', { userId: user.id, email: user.email });
// Output: {"level":"INFO","message":"User registered","service":"identity-register",
//          "correlationId":"abc-123","environment":"dev","timestamp":"..."}
```

### Middy middleware (automático)

```typescript
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';

export const handler = middy(baseHandler)
  .use(injectLambdaContext(logger, { clearState: true }));
// Cada log incluye automáticamente: correlationId, lambdaContext.requestId, xRayTraceId
```

## 🔍 Tracer (X-Ray)

### Configuración

```typescript
import { Tracer } from '@aws-lambda-powertools/tracer';

const tracer = new Tracer({ serviceName: 'identity-register' });
```

### Middy middleware

```typescript
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

export const handler = middy(baseHandler)
  .use(captureLambdaHandler(tracer));
// X-Ray abre/cierra segments automáticamente
```

### Tracing de funciones custom

```typescript
// Tracing manual para funciones async
const result = await tracer.captureMethod(async () => {
  return await db.query('SELECT * FROM users');
})();
```

### Annotations para filtrar en X-Ray console

```typescript
tracer.putAnnotation('userId', user.id);
tracer.putAnnotation('environment', process.env.ENVIRONMENT!);
// Permite filtrar traces por userId o environment
```

### Costos X-Ray

| Concepto | Free tier | Precio |
|---|---|---|
| Traces grabados | 100,000/mes | $5.00 por millón |
| Traces recuperados/escaneados | 1M/mes | $0.50 por millón |
| Almacenamiento | 30 días gratis | $0.05 por millón/mes |

## 📈 Metrics (EMF = GRATIS)

### Configuración

```typescript
import { Metrics, MetricUnits } from '@aws-lambda-powertools/metrics';

const metrics = new Metrics({
  namespace: 'SparkMatch',
  serviceName: 'identity',
});
```

### Métricas custom

```typescript
metrics.addMetric('UserRegistered', MetricUnits.Count, 1);
metrics.addMetric('RegistrationLatency', MetricUnits.Milliseconds, 1234);
metrics.addMetric('PasswordHashErrors', MetricUnits.Count, 0);
```

### Middy middleware (publica automáticamente al final de la invocación)

```typescript
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';

export const handler = middy(baseHandler)
  .use(logMetrics(metrics));
```

### 🎯 Por qué EMF es gratis

EMF (Embedded Metric Format) es JSON que se escribe en stdout junto con los logs. CloudWatch
parsea ese JSON y crea las métricas **sin generar una llamada API facturable**. Si emitieras
métricas con `PutMetricData` directo, pagarías **$0.30 por métrica-mes** (las primeras 10K
métricas son gratis, luego cuesta).

## 🔑 Parameters (SSM con caché)

```typescript
import { createSsmReader } from '@spark-match/shared/infra';

const ssm = createSsmReader(); // 5 min caché por defecto

// Lectura con caché
const jwtSecretArn = await ssm.getRequiredString('/spark-match/secret/jwt-arn');

// Caché custom (10 min)
const value = await ssm.getString('/spark-match/config/feature-flags', 600);
```

## 🔁 Idempotency (DynamoDB)

### Configuración

```typescript
import { makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';

const persistenceLayer = new DynamoDBPersistenceLayer({
  tableName: process.env.IDEMPOTENCY_TABLE_NAME!,
});
```

### Wrapping de un handler

```typescript
const baseHandler = async (event: SQSEvent) => {
  // Lógica que no debe ejecutarse 2 veces
  await processUserRegistration(event);
};

export const handler = makeIdempotent(baseHandler, {
  persistenceLayer,
  idempotencyKey: 'user-registration', // o extraer de event
});
```

## 📋 Patrón estándar de observabilidad en Lambdas

```typescript
// contexts/identity/src/handlers/register.ts
import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { RegisterInputSchema } from '../schemas/register.schema.js';

const logger = createLogger('identity-register');
const tracer = new Tracer({ serviceName: 'identity-register' });

export const handler = buildHandler({
  name: 'identity-register',
  inputSchema: RegisterInputSchema,
  logger,
  tracer,
  handler: async (input) => {
    logger.info('Registering user', { email: input.email });
    tracer.putAnnotation('email', input.email);
    // ... lógica ...
    return result;
  },
});
```

Esto automáticamente te da:
- ✅ Logs estructurados JSON con correlationId
- ✅ X-Ray tracing con subsegments
- ✅ Métricas de invocación, error rate, duración
- ✅ Validación de input
- ✅ Error handling estandarizado
- ✅ CORS configurado

## 🔗 Dashboards y alarmas (TODO: Fase 11)

- CloudWatch dashboard con métricas por contexto
- Alarmas: DLQ depth > 0, error rate > 1%, p99 latency > 1s
- Log insights queries predefinidas
- X-Ray service map para visualizar dependencias

## 📚 Referencias

- [Lambda Powertools TypeScript docs](https://docs.powertools.aws.dev/lambda/typescript/latest/)
- [X-Ray pricing](https://aws.amazon.com/xray/pricing/)
- [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)
- [ADR-014: Powertools vs OTel](../docs/DECISIONS.md#adr-014-observabilidad-con-powertools-no-opentelemetry)
