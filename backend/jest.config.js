'use strict';
// Unit tests live in the repo-root tests/ folder (spec 1.3).
module.exports = {
  rootDir: '..',
  roots: ['<rootDir>/tests'],
  modulePaths: ['<rootDir>/backend/node_modules'],
  testEnvironment: 'node',
  collectCoverageFrom: ['backend/src/domain/**/*.js', 'backend/src/lib/**/*.js'],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['json-summary', 'text-summary', 'html'],
};
