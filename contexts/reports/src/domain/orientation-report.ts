// =============================================================================
// Orientation report domain types
// =============================================================================
// The row described by ADR-019 D3. The *content* of a report does not live
// here -- it lives in S3, and the agent is what produces it. This is the
// registry entry: where the objects are, what the report summarises, and under
// what circumstances it was generated.
//
// The backend never stores a URL, only bucket + key + versionId. A presigned
// URL expires (broken row) and one that does not is a permanent capability
// over a minor's psychometric profile.
// =============================================================================

/**
 * A report is born `pending` and ends `ready` or `failed`. There is no
 * transition back: a failed generation produces a new row, not a retry of the
 * old one, so that "what happened on the 10th" stays answerable.
 */
export type ReportStatus = 'pending' | 'ready' | 'failed';

export const REPORT_STATUSES: readonly ReportStatus[] = ['pending', 'ready', 'failed'];

/**
 * One object in S3. `versionId` is null when the bucket has versioning off,
 * which is not the case in any deployed environment but is the case in a
 * local MinIO or a unit test, and a null there is more honest than an
 * invented string.
 */
export interface StoredObject {
  key: string;
  versionId: string | null;
  sizeBytes: number;
  checksumSha256: string;
}

/**
 * The two objects of a report.
 *
 * `json` is the source of truth: from it the PDF can be re-rendered without
 * paying for another model call. `pdf` is what the student downloads, and is
 * derived. That is why the agent uploads the JSON first -- an orphan JSON is
 * recoverable, an orphan PDF is not.
 */
export interface ReportObjects {
  json: StoredObject;
  pdf: StoredObject;
}

export interface OrientationReport {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  status: ReportStatus;

  bucket: string | null;
  objects: ReportObjects | null;

  schemaVersion: string | null;
  riasecCode: string | null;
  profileCompleteness: number | null;
  topCareers: string[] | null;

  datasetSource: string | null;
  datasetSnapshotDate: string | null;

  modelId: string | null;
  langsmithRunId: string | null;
  generationMs: number | null;
  failureReason: string | null;
}

/** What a caller supplies to open a report. Everything else arrives later. */
export type CreateReportInput = {
  userId: string;
};

/**
 * What the generator hands back when it succeeds. Every field the
 * `orientation_report_ready_is_complete` constraint requires is mandatory
 * here, so a caller cannot assemble a "ready" update that the database will
 * then reject at 3am.
 */
export type CompleteReportInput = {
  bucket: string;
  objects: ReportObjects;
  schemaVersion: string;
  riasecCode: string;
  datasetSource: string;
  datasetSnapshotDate: string;
  topCareers: string[];
  profileCompleteness?: number | null;
  modelId?: string | null;
  langsmithRunId?: string | null;
  generationMs?: number | null;
};

/** Thrown when a stored `objects` value is not the shape this module promises. */
export class MalformedReportObjectsError extends Error {
  constructor(reason: string) {
    super(`orientation_report.objects is malformed: ${reason}`);
    this.name = 'MalformedReportObjectsError';
  }
}

function parseStoredObject(value: unknown, which: string): StoredObject {
  if (typeof value !== 'object' || value === null) {
    throw new MalformedReportObjectsError(`\`${which}\` is not an object`);
  }
  const raw = value as Record<string, unknown>;

  if (typeof raw.key !== 'string' || raw.key.length === 0) {
    throw new MalformedReportObjectsError(`\`${which}.key\` is missing`);
  }
  if (typeof raw.sizeBytes !== 'number' || !Number.isFinite(raw.sizeBytes)) {
    throw new MalformedReportObjectsError(`\`${which}.sizeBytes\` is not a number`);
  }
  if (typeof raw.checksumSha256 !== 'string' || raw.checksumSha256.length === 0) {
    throw new MalformedReportObjectsError(`\`${which}.checksumSha256\` is missing`);
  }
  if (raw.versionId !== null && typeof raw.versionId !== 'string') {
    throw new MalformedReportObjectsError(`\`${which}.versionId\` is neither a string nor null`);
  }

  return {
    key: raw.key,
    versionId: raw.versionId ?? null,
    sizeBytes: raw.sizeBytes,
    checksumSha256: raw.checksumSha256,
  };
}

/**
 * Validates a JSONB `objects` value on the way out of the database.
 *
 * This exists because the column is JSONB, which was a deliberate trade: one
 * column instead of eight, at the price of Postgres not type-checking what
 * goes in. The check has to happen *somewhere*, and the read path is the
 * honest place -- it is the only point where every row, including ones
 * written by a previous version of this code or by the agent, has to be
 * understood.
 *
 * Throwing rather than returning null is also deliberate. A report whose
 * objects cannot be read is not "a report without objects", it is a broken
 * row, and quietly serving it as if the download simply were not ready yet
 * would hide the breakage for as long as nobody complains.
 */
export function parseReportObjects(value: unknown): ReportObjects {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedReportObjectsError('not a JSON object');
  }
  const raw = value as Record<string, unknown>;

  if (!('json' in raw)) throw new MalformedReportObjectsError('`json` is missing');
  if (!('pdf' in raw)) throw new MalformedReportObjectsError('`pdf` is missing');

  return {
    json: parseStoredObject(raw.json, 'json'),
    pdf: parseStoredObject(raw.pdf, 'pdf'),
  };
}

/** Same idea for `top_careers`: names, in order, and nothing else. */
export function parseTopCareers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new MalformedReportObjectsError('`top_careers` is not an array');
  }
  for (const [i, name] of value.entries()) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new MalformedReportObjectsError(`\`top_careers[${i}]\` is not a non-empty string`);
    }
  }
  return value as string[];
}
