/**
 * Minimal in-memory stand-in for the Prisma client: just the calls the auth
 * and user routes make. Tests mock config/database so getPrisma() returns
 * this, and never touch a real database.
 */
const crypto = require('crypto');
const { OWNED_MODELS } = require('../../src/services/user-lifecycle');

function pick(row, select) {
  if (!row || !select) return row ? { ...row } : null;
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

function matches(row, where = {}) {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

function createFakePrisma() {
  const users = [];
  const user = {
    rows: users,
    async findUnique({ where, select }) {
      return pick(users.find((u) => matches(u, where)), select);
    },
    async findFirst({ where, select }) {
      return pick(users.find((u) => matches(u, where)), select);
    },
    async findMany({ where, select } = {}) {
      return users.filter((u) => matches(u, where)).map((u) => pick(u, select));
    },
    async count({ where } = {}) {
      return users.filter((u) => matches(u, where)).length;
    },
    async create({ data, select }) {
      const row = { id: crypto.randomUUID(), refreshToken: null, lastLogin: null, createdAt: new Date(), ...data };
      users.push(row);
      return pick(row, select);
    },
    async update({ where, data, select }) {
      const row = users.find((u) => matches(u, where));
      if (!row) throw new Error('Record to update not found');
      Object.assign(row, data);
      return pick(row, select);
    },
    async delete({ where }) {
      const index = users.findIndex((u) => matches(u, where));
      if (index === -1) throw new Error('Record to delete does not exist');
      return users.splice(index, 1)[0];
    },
  };

  const client = { user };
  // Tables with a createdBy userId (see services/user-lifecycle.js).
  for (const model of OWNED_MODELS) {
    const rows = [];
    client[model] = {
      rows,
      async updateMany({ where, data }) {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    };
  }
  client.$transaction = async (fn) => fn(client);
  return client;
}

module.exports = { createFakePrisma };
