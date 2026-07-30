// =============================================================================
// generate-openapi.ts — emit `docs/openapi.json` from Zod operations
// =============================================================================
// Reads the operations declared in `contexts/identity/src/openapi.ts`,
// derives JSON Schemas via Zod 4's `z.toJSONSchema()`, and writes a
// single OpenAPI 3.1 document to `docs/openapi.json`.
//
// Run with: npm run generate:openapi
// =============================================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  IDENTITY_OPERATIONS,
  type Operation,
  type OperationParameter,
} from '../contexts/identity/src/openapi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Convert a Zod schema to a JSON Schema fragment, dereferencing internal $ref. */
function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: 'jsonSchema7',
    removeAdditionalStrategy: 'passthrough',
  }) as Record<string, unknown>;
}

/** Build a JSON Schema for a path / query parameter (string-only primitives). */
function paramSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const json = jsonSchemaFor(schema);
  return json;
}

interface OpenApiParam {
  name: string;
  in: 'query' | 'path';
  required?: boolean;
  description?: string;
  schema: Record<string, unknown>;
}

function parametersFor(op: Operation): OpenApiParam[] | undefined {
  if (!op.parameters || op.parameters.length === 0) return undefined;
  return op.parameters.map((p: OperationParameter) => ({
    name: p.name,
    in: p.in,
    required: p.required ?? p.in === 'path',
    description: p.description,
    schema: paramSchemaFor(p.schema),
  }));
}

function requestBodyFor(op: Operation): Record<string, unknown> | undefined {
  if (!op.requestBody) return undefined;
  const json = jsonSchemaFor(op.requestBody);
  return {
    required: true,
    content: {
      'application/json': { schema: json },
    },
  };
}

function responsesFor(
  op: Operation,
): Record<string, { description: string; content: { 'application/json': { schema: Record<string, unknown> } } }> {
  const result: Record<
    string,
    { description: string; content: { 'application/json': { schema: Record<string, unknown> } } }
  > = {};
  for (const r of op.responses) {
    const json = jsonSchemaFor(r.schema);
    result[String(r.statusCode)] = {
      description: r.description,
      content: {
        'application/json': { schema: json },
      },
    };
  }
  return result;
}

function securityFor(op: Operation): Array<Record<string, string[]>> | undefined {
  if (op.security === 'none') return undefined;
  return [{ bearerAuth: [] }];
}

interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  paths: Record<
    string,
    Record<
      string,
      {
        operationId: string;
        summary: string;
        description?: string;
        tags: string[];
        security?: Array<Record<string, string[]>>;
        parameters?: OpenApiParam[];
        requestBody?: Record<string, unknown>;
        responses: Record<
          string,
          { description: string; content: { 'application/json': { schema: Record<string, unknown> } } }
        >;
      }
    >
  >;
  components: { securitySchemes: Record<string, { type: string; scheme: string; bearerFormat: string }> };
}

function buildDoc(): OpenApiDoc {
  const paths: OpenApiDoc['paths'] = {};
  for (const op of IDENTITY_OPERATIONS) {
    if (!paths[op.path]) paths[op.path] = {};
    paths[op.path][op.method.toLowerCase()] = {
      operationId: op.operationId,
      summary: op.summary,
      description: op.description,
      tags: op.tags,
      security: securityFor(op),
      parameters: parametersFor(op),
      requestBody: requestBodyFor(op),
      responses: responsesFor(op),
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Spark Match Backend API (Identity context)',
      version: '0.1.0',
      description:
        'Auto-generated from Zod schemas via `npm run generate:openapi`. Source: `contexts/identity/src/openapi.ts`. Do not edit `docs/openapi.json` directly — regenerate after schema changes.',
    },
    servers: [
      { url: 'https://<api-id>.execute-api.<region>.amazonaws.com/dev', description: 'dev' },
      { url: 'https://<api-id>.execute-api.<region>.amazonaws.com/staging', description: 'staging' },
      { url: 'https://<api-id>.execute-api.<region>.amazonaws.com/prod', description: 'prod' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT (HS256)',
        },
      },
    },
  };
}

function main(): void {
  const doc = buildDoc();
  const outPath = resolve(__dirname, '../docs/openapi.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  const pathCount = Object.keys(doc.paths).length;
  const opCount = Object.values(doc.paths).reduce(
    (acc, methods) => acc + Object.keys(methods).length,
    0,
  );
  process.stdout.write(`Wrote ${outPath} (${pathCount} paths, ${opCount} operations)\n`);
}

main();
