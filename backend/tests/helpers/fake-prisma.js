/**
 * Minimal in-memory stand-in for the Prisma `user` model: just the calls the
 * auth routes and middleware make. Tests mock config/database so getPrisma()
 * returns this, and never touch a real database.
 */
const crypto = require('crypto');

function pick(row, select) {
  if (!row || !select) return row ? { ...row } : null;
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

function matches(row, where) {
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
  };
  return { user };
}

module.exports = { createFakePrisma };
