const shared = {
  rootDir: '.',
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@database/(.*)$': '<rootDir>/src/database/$1',
    '^@api/(.*)$': '<rootDir>/src/api/$1',
  },
  clearMocks: true,
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
    },
    {
      ...shared,
      displayName: 'api',
      testMatch: ['<rootDir>/test/api/**/*.spec.ts'],
    },
  ],
  testTimeout: 30000,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/database/migrations/**',
  ],
  coverageDirectory: 'coverage',
};
