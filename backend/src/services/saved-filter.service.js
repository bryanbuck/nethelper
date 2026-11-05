/**
 * Saved Devices-page filters: named views (filters, search, sort) private to
 * the user who saved them. Every query is scoped by userId, so another user's
 * filter is "not found". Page and page size are not part of a saved filter;
 * the browser remembers those with the last view.
 */
const { getPrisma } = require('../config/database');
const {
  FILTER_KEYS, SORT_KEYS, MAX_SAVED_FILTERS, MAX_NAME_LENGTH, MAX_VALUE_LENGTH,
} = require('../constants/device-view');

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

const cleanString = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_VALUE_LENGTH) : '');

/** Keeps only what the Devices table understands; anything else is dropped. */
function normalizeView(view) {
  const source = view && typeof view === 'object' && !Array.isArray(view) ? view : {};
  const rawFilters = source.filters && typeof source.filters === 'object' ? source.filters : {};
  const filters = {};
  for (const key of FILTER_KEYS) {
    const value = cleanString(rawFilters[key]);
    if (value) filters[key] = value;
  }
  const sort = Array.isArray(source.sortBy) ? source.sortBy[0] : null;
  const sortBy = sort && SORT_KEYS.includes(sort.key)
    ? [{ key: sort.key, order: sort.order === 'desc' ? 'desc' : 'asc' }]
    : [];
  return { filters, search: cleanString(source.search), sortBy };
}

function normalizeName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) throw httpError(400, 'A name is required');
  if (trimmed.length > MAX_NAME_LENGTH) throw httpError(400, `Names are at most ${MAX_NAME_LENGTH} characters`);
  return trimmed;
}

const nameTaken = (error, name) => (error?.code === 'P2002'
  ? httpError(409, `You already have a saved filter named "${name}"`)
  : error);

const SELECT = { id: true, name: true, view: true, createdAt: true, updatedAt: true };

async function list(userId) {
  return getPrisma().savedDeviceFilter.findMany({ where: { userId }, orderBy: { name: 'asc' }, select: SELECT });
}

async function create(userId, { name, view } = {}) {
  const prisma = getPrisma();
  const cleanName = normalizeName(name);
  if (await prisma.savedDeviceFilter.count({ where: { userId } }) >= MAX_SAVED_FILTERS) {
    throw httpError(400, `You can keep at most ${MAX_SAVED_FILTERS} saved filters; delete one first`);
  }
  try {
    return await prisma.savedDeviceFilter.create({
      data: { userId, name: cleanName, view: normalizeView(view) },
      select: SELECT,
    });
  } catch (error) {
    throw nameTaken(error, cleanName);
  }
}

async function findOwn(userId, id) {
  const row = await getPrisma().savedDeviceFilter.findFirst({ where: { id, userId }, select: { id: true } });
  if (!row) throw httpError(404, 'Saved filter not found');
  return row;
}

async function update(userId, id, { name, view } = {}) {
  await findOwn(userId, id);
  const data = {};
  if (name !== undefined) data.name = normalizeName(name);
  if (view !== undefined) data.view = normalizeView(view);
  if (!Object.keys(data).length) throw httpError(400, 'Nothing to change');
  try {
    return await getPrisma().savedDeviceFilter.update({ where: { id }, data, select: SELECT });
  } catch (error) {
    throw nameTaken(error, data.name);
  }
}

async function remove(userId, id) {
  await findOwn(userId, id);
  await getPrisma().savedDeviceFilter.delete({ where: { id } });
}

module.exports = { list, create, update, remove, normalizeView };
