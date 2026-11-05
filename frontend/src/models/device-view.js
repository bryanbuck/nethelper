/**
 * The Devices page's view: filters, search, sort, page and page size.
 *
 * The whole view lives in the URL (reload, back/forward and shared links show
 * the same list), and the last one is remembered per user in this browser, so
 * a bare /devices opens where the user left off. A saved filter (server-side,
 * per user) holds the filters, search and sort, never the page or page size.
 *
 * FILTER_KEYS and SORT_KEYS mirror backend/src/constants/device-view.js
 * (parity-tested).
 */
export const FILTER_KEYS = ['status', 'type', 'location', 'platform', 'credential', 'group']
export const SORT_KEYS = ['name', 'type', 'managementMode', 'ipAddress', 'location', 'cloudStatus', 'lastSeen', 'status']
export const STATUSES = ['online', 'offline', 'warning', 'maintenance']
// The table's page-size choices (Vuetify's defaults); -1 is "All"
export const PAGE_SIZES = [10, 25, 50, 100, -1]
export const DEFAULT_PAGE_SIZE = 10
const MAX_VALUE_LENGTH = 200

// URL keys besides the filters (which keep their own names: ?status= and
// ?group= links from the dashboard and the Groups dialog predate this)
const SEARCH_PARAM = 'q'
const SORT_PARAM = 'sort'
const PAGE_PARAM = 'page'
const PAGE_SIZE_PARAM = 'per'
export const VIEW_QUERY_KEYS = [...FILTER_KEYS, SEARCH_PARAM, SORT_PARAM, PAGE_PARAM, PAGE_SIZE_PARAM]

export const emptyFilters = () => Object.fromEntries(FILTER_KEYS.map((k) => [k, null]))

export const defaultView = () => ({
  filters: emptyFilters(),
  search: '',
  sortBy: [],
  page: 1,
  itemsPerPage: DEFAULT_PAGE_SIZE
})

const cleanString = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_VALUE_LENGTH) : '')

function cleanFilters(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const filters = emptyFilters()
  for (const key of FILTER_KEYS) {
    const value = cleanString(source[key])
    if (!value) continue
    if (key === 'status' && !STATUSES.includes(value)) continue
    filters[key] = value
  }
  return filters
}

function cleanSort(raw) {
  const sort = Array.isArray(raw) ? raw[0] : null
  return sort && SORT_KEYS.includes(sort.key)
    ? [{ key: sort.key, order: sort.order === 'desc' ? 'desc' : 'asc' }]
    : []
}

const cleanPage = (value) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 ? n : 1
}

const cleanPageSize = (value) => {
  const n = Number(value)
  return PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE
}

/** A complete, valid view from anything (stored JSON, a saved filter, a patch). */
export function normalizeView(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    filters: cleanFilters(source.filters),
    search: cleanString(source.search),
    sortBy: cleanSort(source.sortBy),
    page: cleanPage(source.page),
    itemsPerPage: cleanPageSize(source.itemsPerPage)
  }
}

/** URL query for a view; defaults are left out, so an unfiltered list is a bare /devices. */
export function viewToQuery(view) {
  const v = normalizeView(view)
  const query = {}
  for (const key of FILTER_KEYS) if (v.filters[key]) query[key] = v.filters[key]
  if (v.search) query[SEARCH_PARAM] = v.search
  if (v.sortBy.length) query[SORT_PARAM] = `${v.sortBy[0].key}:${v.sortBy[0].order}`
  if (v.page > 1) query[PAGE_PARAM] = String(v.page)
  if (v.itemsPerPage !== DEFAULT_PAGE_SIZE) query[PAGE_SIZE_PARAM] = v.itemsPerPage === -1 ? 'all' : String(v.itemsPerPage)
  return query
}

const firstString = (value) => (Array.isArray(value) ? value[0] : value)

/** The view a URL query describes; anything invalid falls back to the default. */
export function viewFromQuery(query = {}) {
  const get = (key) => firstString(query[key])
  const [sortKey, sortOrder] = String(get(SORT_PARAM) || '').split(':')
  const per = get(PAGE_SIZE_PARAM)
  return normalizeView({
    filters: Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k)])),
    search: get(SEARCH_PARAM),
    sortBy: sortKey ? [{ key: sortKey, order: sortOrder }] : [],
    page: get(PAGE_PARAM),
    itemsPerPage: per === 'all' ? -1 : per
  })
}

/** Does the query say anything about the view? A bare /devices doesn't. */
export const hasViewQuery = (query = {}) => VIEW_QUERY_KEYS.some((k) => query[k] !== undefined)

/** The query without the view's keys (anything else on the URL is kept). */
export const otherQuery = (query = {}) =>
  Object.fromEntries(Object.entries(query).filter(([k]) => !VIEW_QUERY_KEYS.includes(k)))

/** Same view, as the URL would say it (normalization included). */
export const sameView = (a, b) => JSON.stringify(viewToQuery(a)) === JSON.stringify(viewToQuery(b))

/** What a saved filter holds: filters (set ones only), search and sort. */
export function savedPart(view) {
  const v = normalizeView(view)
  return {
    filters: Object.fromEntries(Object.entries(v.filters).filter(([, value]) => value)),
    search: v.search,
    sortBy: v.sortBy
  }
}

/** Same filters, search and sort (page and page size don't matter). */
export const sameFilterSet = (a, b) => JSON.stringify(savedPart(a)) === JSON.stringify(savedPart(b))

/** Any filter or search set? (Sort alone doesn't make a list "filtered".) */
export function isFiltered(view) {
  const v = savedPart(view)
  return Boolean(v.search) || Object.keys(v.filters).length > 0
}

// The last view, per user, in this browser. Wrapped: storage can be missing
// or throw (private windows, blocked site data); the page works without it.
export const LAST_VIEW_PREFIX = 'nethelper.devicesView.'

export function readLastView(userId, storage = globalThis.localStorage) {
  if (!userId) return null
  try {
    const raw = storage?.getItem(LAST_VIEW_PREFIX + userId)
    return raw ? normalizeView(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function writeLastView(userId, view, storage = globalThis.localStorage) {
  if (!userId) return
  try {
    storage?.setItem(LAST_VIEW_PREFIX + userId, JSON.stringify(normalizeView(view)))
  } catch {
    // Storage unavailable: the view is remembered in the URL only.
  }
}
