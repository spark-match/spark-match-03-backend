import middy from '@middy/core';
import jsonBodyParser from '@middy/http-json-body-parser';
import httpErrorHandler from '@middy/http-error-handler';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import cors from '@middy/http-cors';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import type { Logger } from '@aws-lambda-powertools/logger';
import type { Tracer } from '@aws-lambda-powertools/tracer';
import { z, type ZodSchema } from 'zod';
import { formatResponse, formatError } from '../http/api-response.js';
import { ApiError } from '../http/api-error.js';
import { validatePayload } from '../events/schema-validator.js';

export interface HandlerConfig<TInput, TOutput> {
  name: string;
  inputSchema: ZodSchema<TInput>;
  logger: Logger;
  tracer: Tracer;
  handler: (input: TInput, event: unknown, context: unknown) => Promise<TOutput>;
  enableCors?: boolean;
  requireAuth?: boolean;
}

export type ApiEvent = {
  httpMethod: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
  pathParameters: Record<string, string> | null;
  requestContext: {
    requestId: string;
    authorizer?: { jwt?: { claims?: { sub?: string; email?: string } } };
  };
};

export function buildHandler<TInput, TOutput>(
  config: HandlerConfig<TInput, TOutput>,
) {
  const baseHandler = async (event: ApiEvent) => {
    try {
      let input: TInput;
      if (event.body) {
        const parsed = event.body ? JSON.parse(event.body) : undefined;
        input = validatePayload(config.inputSchema, parsed);
      } else {
        input = validatePayload(config.inputSchema, undefined);
      }

      const output = await config.handler(input, event, null);
      return formatResponse(output, 200, event.requestContext.requestId);
    } catch (err) {
      if (!(err instanceof ApiError)) {
        config.logger.error('Unhandled error in handler', { error: err });
      }
      return formatError(err, event.requestContext.requestId);
    }
  };

  let pipeline = middy(baseHandler)
    .use(httpHeaderNormalizer())
    .use(jsonBodyParser())
    .use(injectLambdaContext(config.logger, { clearState: true }))
    .use(captureLambdaHandler(config.tracer))
    .use(httpErrorHandler());

  if (config.enableCors !== false) {
    const corsEnv = process.env.CORS_ORIGINS;
    const corsOptions: { origin: string; origins: string[]; methods: string } = {
      origin: '*',
      origins: ['*'],
      methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (corsEnv && corsEnv !== '*') {
      const list = corsEnv.split(',').map((s) => s.trim()).filter(Boolean);
      corsOptions.origin = list[0] ?? '*';
      corsOptions.origins = list;
    }
    pipeline = pipeline.use(cors(corsOptions));
  }

  return pipeline;
}

export const BodySchema = z.unknown();

export type { z };
