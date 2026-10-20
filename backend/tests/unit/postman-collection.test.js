/**
 * The Postman collection is generated from the route tables
 * (scripts/generate-postman.js). This fails when a route changes and the
 * collection wasn't regenerated, and guards it against carrying credentials.
 */
const fs = require('fs');
const { createFakePrisma } = require('../helpers/fake-prisma');

const mockPrisma = createFakePrisma();
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const { render, OUTPUT } = require('../../scripts/generate-postman');

describe('Postman collection', () => {
  const committed = fs.readFileSync(OUTPUT, 'utf8');

  test('matches the route tables (run node scripts/generate-postman.js)', () => {
    expect(committed).toBe(render());
  });

  test('carries no credentials', () => {
    const collection = JSON.parse(committed);
    for (const variable of collection.variable) {
      if (/password|token|secret/i.test(variable.key)) expect(variable.value).toBe('');
    }
    // Secret-looking body fields are empty or a {{variable}}.
    const secretValues = [...committed.matchAll(/\\"\w*(?:password|secret|token|apiKey)\w*\\": \\"([^"\\]*)\\"/gi)]
      .map((m) => m[1]);
    expect(secretValues.length).toBeGreaterThan(0);
    for (const value of secretValues) expect(value).toMatch(/^(|\{\{\w+\}\})$/);
    expect(committed).not.toMatch(/eyJ[\w-]{10,}\.[\w-]{10,}/); // no JWTs
  });
});
