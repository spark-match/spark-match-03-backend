// Global test setup for all Vitest tests.
// This file is loaded before each test file (see vitest.config.ts).
import { afterAll } from 'vitest';

afterAll(() => {
  // Close any open handles (DB pools, AWS SDK clients) after all tests
  // to prevent test runners from hanging.
});
