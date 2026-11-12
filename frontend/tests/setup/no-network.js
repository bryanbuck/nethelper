// Unit tests never reach the network. A request that slips through (an
// unmocked store refresh behind a socket handler, say) went to whatever
// listened on jsdom's localhost:3000, often the dev backend: its replies came
// back after the spec file was torn down and showed up, now and then, as
// "unhandled errors" in a green run. Here every request fails at once, and
// the file fails with the list, so a leak is found on every run.
const requests = []

function refuse(what) {
  requests.push(what)
  throw new Error(`Unit tests must not make network requests (${what}): mock the service or store call`)
}

const open = XMLHttpRequest.prototype.open
XMLHttpRequest.prototype.open = function guardedOpen(method, url, ...rest) {
  refuse(`${method} ${url}`)
  return open.call(this, method, url, ...rest)
}
globalThis.fetch = async (input) => refuse(`fetch ${input?.url || input}`)

afterAll(() => {
  expect(requests, 'network requests made by this spec file').toEqual([])
})
