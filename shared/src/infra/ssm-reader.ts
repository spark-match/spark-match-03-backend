import { getParameter } from '@aws-lambda-powertools/parameters/ssm';

const DEFAULT_MAX_AGE_SECONDS = 300;

export interface SsmReader {
  getString(name: string, maxAge?: number): Promise<string | undefined>;
  getRequiredString(name: string, maxAge?: number): Promise<string>;
}

export function createSsmReader(defaultMaxAge = DEFAULT_MAX_AGE_SECONDS): SsmReader {
  return {
    async getString(name: string, maxAge = defaultMaxAge): Promise<string | undefined> {
      const value = await getParameter(name, {
        maxAge,
        throwOnError: false,
      });
      if (typeof value === 'string') return value;
      if (typeof value === 'object' && value !== null && 'Value' in value) {
        const v = (value as { Value: string }).Value;
        return v;
      }
      return undefined;
    },

    async getRequiredString(name: string, maxAge = defaultMaxAge): Promise<string> {
      const value = await this.getString(name, maxAge);
      if (value === undefined) {
        throw new Error(`Required SSM parameter not found or empty: ${name}`);
      }
      return value;
    },
  };
}
