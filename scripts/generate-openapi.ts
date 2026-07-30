// =============================================================================
// generate-openapi.ts - emit `docs/openapi.json` from Zod operations
// =============================================================================
// Reads the operations declared in `contexts/identity/src/openapi.ts`,
// derives JSON Schemas via Zod 4's built-in `z.toJSONSchema()`, and writes a
// single OpenAPI 3.1 document to `docs/openapi.json`.
//
// Run with: npm run generate:openapi
//
// `buildDoc()` is exported so tests can exercise the branching logic
// without going through the CLI write step. The CLI entrypoint
// invokes `buildDoc() + writeDoc()` only when the script is run as
// `node`'s entry file (detected by comparing `process.argv[1]`).
// =============================================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  IDENTITY_OPERATIONS,
  ERROR_RESPONSE_SCHEMA,
  type Operation,
  type OperationParameter,
} from '../contexts/identity/src/openapi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Convert a Zod schema to a JSON Schema fragment. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: 'jsonSchema7',
  }) as Record<string, unknown>;
}

function parametersFor(op: Operation): unknown[] | undefined {
  if (!op.parameters || op.parameters.length === 0) return undefined;
  return op.parameters.map((p: OperationParameter) => ({
    name: p.name,
    in: p.in,
    required: p.required ?? p.in === 'path',
    description: p.description,
    schema: jsonSchemaFor(p.schema),
  }));
}

function requestBodyFor(op: Operation): Record<string, unknown> | undefined {
  if (!op.requestBody) return undefined;
  return {
    required: true,
    content: {
      'application/json': { schema: jsonSchemaFor(op.requestBody) },
    },
  };
}

function responsesFor(
  op: Operation,
): Record<
  string,
  { description: string; content: { 'application/json': { schema: Record<string, unknown> } } }
> {
  const out: Record<
    string,
    { description: string; content: { 'application/json': { schema: Record<string, unknown> } } }
  > = {};
  for (const r of op.responses) {
    out[String(r.statusCode)] = {
      description: r.description,
      content: {
        'application/json': { schema: jsonSchemaFor(r.schema) },
      },
    };
  }
  return out;
}

function securityFor(op: Operation): Array<Record<string, string[]>> | undefined {
  if (op.security === 'none') return undefined;
  return [{ bearerAuth: [] }];
}

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: {
    securitySchemes: Record<string, { type: string; scheme: string; bearerFormat: string }>;
    schemas?: Record<string, unknown>;
  };
}

export function buildDoc(): OpenApiDoc {
  const paths: OpenApiDoc['paths'] = {};
  for (const op of IDENTITY_OPERATIONS) {
    if (!paths[op.path]) {
      paths[op.path] = {};
    }
    const pathItem = paths[op.path];
    if (!pathItem) continue;
    pathItem[op.method.toLowerCase()] = {
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
        'Auto-generated from Zod schemas via `npm run generate:openapi`. Source: `contexts/identity/src/openapi.ts`. Do not edit `docs/openapi.json` directly - regenerate after schema changes.',
    },
    servers: [
      { url: 'https://<api-id>.execute-api.<region>.amazonaws.com/dev', description: 'dev' },
      { url: 'https://<api-id>.execute-api.<region>.amazonaws.com/staging', description: 'staging' },
      { url: 'https://<api-id>.execute-api.<region>.amazonaws.com/prod', description: 'prod' },
    ],
    paths: paths ?? {},
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT (HS256)',
        },
      },
      schemas: {
        ErrorResponse: jsonSchemaFor(ERROR_RESPONSE_SCHEMA),
      },
    },
  };
}

export function writeDoc(doc: OpenApiDoc): string {
  const outPath = resolve(__dirname, '../docs/openapi.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return outPath;
}

function main(): void {
  const outPath = writeDoc(buildDoc());
  process.stdout.write(`Wrote ${outPath}\n`);
}

// Detect CLI invocation (vs. test imports).
// `process.argv[1]` is the path of the script that node is executing.
// When run via `tsx scripts/generate-openapi.ts`, argv[1] ends with that path.
// When the module is imported by vitest, argv[1] is the test runner path.
const isDirectInvocation = process.argv[1]?.endsWith('generate-openapi.ts') ?? false;

if (isDirectInvocation) {
  main();
}
