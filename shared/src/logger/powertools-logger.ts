import { Logger } from '@aws-lambda-powertools/logger';

export type ServiceName = string;

export function createLogger(serviceName: ServiceName): Logger {
  return new Logger({
    serviceName,
    logLevel: (process.env.LOG_LEVEL as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') || 'INFO',
    environment: process.env.ENVIRONMENT,
  });
}
