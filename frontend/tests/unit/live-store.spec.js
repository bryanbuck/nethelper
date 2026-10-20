// Reducers behind the device Live tab (stores/live.js).
import { applyPortUpdate, applyMetrics, applyEvent, HISTORY_POINTS, EVENT_LIMIT } from '@/stores/live'

describe('live store reducers', () => {
  const ports = [{ port: '1/1/1', linkUp: true }, { port: '1/1/2', linkUp: false }]

  test('applyPortUpdate replaces one port and ignores unknown ones', () => {
    const next = applyPortUpdate(ports, { port: '1/1/2', linkUp: true })
    expect(next[1].linkUp).toBe(true)
    expect(next[0]).toBe(ports[0])
    expect(applyPortUpdate(ports, { port: '9/9/9' })).toBe(ports)
  })

  test('applyMetrics records nothing until rates exist', () => {
    const first = { hasRates: false, at: 't0', ports: { '1/1/1': { rxBps: null, txBps: null } } }
    expect(applyMetrics({}, first)).toEqual({})
  })

  test('applyMetrics appends total throughput and caps the history', () => {
    let history = {}
    for (let i = 0; i < HISTORY_POINTS + 5; i += 1) {
      history = applyMetrics(history, { hasRates: true, at: `t${i}`, ports: { '1/1/1': { rxBps: i, txBps: 1 } } })
    }
    expect(history['1/1/1']).toHaveLength(HISTORY_POINTS)
    expect(history['1/1/1'].at(-1)).toEqual({ at: `t${HISTORY_POINTS + 4}`, bps: HISTORY_POINTS + 5 })
  })

  test('applyMetrics skips ports whose counters reset (null rates)', () => {
    const history = applyMetrics({}, { hasRates: true, at: 't', ports: { '1/1/1': { rxBps: null, txBps: null } } })
    expect(history['1/1/1']).toBeUndefined()
  })

  test('applyEvent prepends, dedupes by id, and caps', () => {
    let events = []
    events = applyEvent(events, { id: 'a', type: 'port.link.down' })
    events = applyEvent(events, { id: 'b', type: 'port.link.up' })
    events = applyEvent(events, { id: 'a', type: 'port.link.down' })
    expect(events.map((e) => e.id)).toEqual(['b', 'a'])
    for (let i = 0; i < EVENT_LIMIT + 3; i += 1) events = applyEvent(events, { id: `x${i}` })
    expect(events).toHaveLength(EVENT_LIMIT)
  })
})
