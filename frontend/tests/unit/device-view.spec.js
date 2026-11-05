// The Devices page's view (models/device-view.js): URL round-trip, defaults
// left out of the URL, junk dropped, saved-filter comparison, the remembered
// last view per user, and parity with backend/src/constants/device-view.js.
import { createRequire } from 'node:module'
import {
  FILTER_KEYS, SORT_KEYS, defaultView, normalizeView, viewToQuery, viewFromQuery, hasViewQuery,
  otherQuery, sameView, savedPart, sameFilterSet, isFiltered, readLastView, writeLastView, LAST_VIEW_PREFIX
} from '@/models/device-view'

const require = createRequire(import.meta.url)
const backend = require('../../../backend/src/constants/device-view.js')

const view = (over = {}) => normalizeView({ ...defaultView(), ...over })

describe('device-view mirrors backend constants/device-view', () => {
  test('filter and sort keys', () => {
    expect(FILTER_KEYS).toEqual(backend.FILTER_KEYS)
    expect([...SORT_KEYS].sort()).toEqual([...backend.SORT_KEYS].sort())
  })
})

describe('URL', () => {
  test('the default view is a bare /devices', () => {
    expect(viewToQuery(defaultView())).toEqual({})
    expect(hasViewQuery({})).toBe(false)
  })

  test('a full view round-trips', () => {
    const v = view({
      filters: { status: 'offline', type: 'switch', location: 'HQ', platform: 'aos-cx', credential: 'none', group: 'g1' },
      search: 'core',
      sortBy: [{ key: 'name', order: 'desc' }],
      page: 3,
      itemsPerPage: 25
    })
    const query = viewToQuery(v)
    expect(query).toEqual({
      status: 'offline', type: 'switch', location: 'HQ', platform: 'aos-cx', credential: 'none', group: 'g1',
      q: 'core', sort: 'name:desc', page: '3', per: '25'
    })
    expect(viewFromQuery(query)).toEqual(v)
  })

  test('"All" rows is per=all', () => {
    expect(viewToQuery(view({ itemsPerPage: -1 }))).toEqual({ per: 'all' })
    expect(viewFromQuery({ per: 'all' }).itemsPerPage).toBe(-1)
  })

  test('the dashboard\'s ?status= link still works', () => {
    expect(viewFromQuery({ status: 'warning' })).toEqual(view({ filters: { status: 'warning' } }))
  })

  test('junk falls back to defaults', () => {
    expect(viewFromQuery({ status: 'exploded', sort: 'constructor:asc', page: '-2', per: '7' })).toEqual(defaultView())
    expect(viewFromQuery({ page: 'abc', sort: 'name:sideways' })).toEqual(view({ sortBy: [{ key: 'name', order: 'asc' }] }))
  })

  test('repeated params take the first', () => {
    expect(viewFromQuery({ status: ['online', 'offline'] }).filters.status).toBe('online')
  })

  test('other query keys are kept apart', () => {
    expect(otherQuery({ status: 'online', tab: 'x', page: '2' })).toEqual({ tab: 'x' })
  })

  test('sameView ignores how the view was spelled', () => {
    expect(sameView(view({ search: ' core ' }), view({ search: 'core' }))).toBe(true)
    expect(sameView(view({ page: 2 }), view())).toBe(false)
  })
})

describe('saved filters', () => {
  test('a saved filter holds filters, search and sort only', () => {
    expect(savedPart(view({ filters: { status: 'online' }, search: 'x', page: 4, itemsPerPage: 50 })))
      .toEqual({ filters: { status: 'online' }, search: 'x', sortBy: [] })
  })

  test('matching ignores the page and page size', () => {
    const saved = { filters: { group: 'g1' }, search: '', sortBy: [] }
    expect(sameFilterSet(saved, view({ filters: { group: 'g1' }, page: 5, itemsPerPage: 100 }))).toBe(true)
    expect(sameFilterSet(saved, view({ filters: { group: 'g1' }, sortBy: [{ key: 'name', order: 'asc' }] }))).toBe(false)
  })

  test('sort alone is not filtered', () => {
    expect(isFiltered(view({ sortBy: [{ key: 'name', order: 'asc' }] }))).toBe(false)
    expect(isFiltered(view({ search: 'x' }))).toBe(true)
  })
})

describe('the remembered view', () => {
  const memoryStorage = () => {
    const data = new Map()
    return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data }
  }

  test('is kept per user', () => {
    const storage = memoryStorage()
    writeLastView('u1', view({ page: 3, itemsPerPage: 50 }), storage)
    expect(readLastView('u1', storage)).toEqual(view({ page: 3, itemsPerPage: 50 }))
    expect(readLastView('u2', storage)).toBeNull()
    expect([...storage.data.keys()]).toEqual([`${LAST_VIEW_PREFIX}u1`])
  })

  test('without a user, or with broken or throwing storage, there is none', () => {
    const storage = memoryStorage()
    writeLastView(null, view({ page: 2 }), storage)
    expect(storage.data.size).toBe(0)
    storage.setItem(`${LAST_VIEW_PREFIX}u1`, '{not json')
    expect(readLastView('u1', storage)).toBeNull()
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(readLastView('u1', throwing)).toBeNull()
    expect(() => writeLastView('u1', view(), throwing)).not.toThrow()
  })
})
