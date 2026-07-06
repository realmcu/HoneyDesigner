// Root-level Jest config: pure-logic unit tests for src/ (vscode-free modules).
// Separate from tools/jest.config.js, which covers the tools/ package with its own
// node_modules. This config exercises HmlParser / HmlValidationService /
// NavLayoutService / NavEditService — none of which import 'vscode' — directly
// against the TS sources, so it can run in plain CI without a VS Code host.
module.exports = {
  displayName: 'src',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/test/jest'],
  testMatch: ['**/*.test.ts'],
  testTimeout: 15000,
  maxWorkers: 1, // filesystem-touching tests (NavLayoutService/NavEditService) run serially
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
