// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  // this preset adds babel-jest for JS files + ts-jest for TS files in ESM mode
  preset: 'ts-jest/presets/js-with-ts-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        useESM: true,
      },
    ],
    // JS will be handled by babel-jest via the preset
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // jest.config.ts
  transformIgnorePatterns: [],

  // allow noble’s ESM to be transformed
  testMatch: ['**/__tests__/**/*.test.ts'],
};

export default config;
