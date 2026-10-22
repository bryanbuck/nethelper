// handleApiError (utils/apiError.js): the 429 from NetHelper's API limit.
import { handleApiError } from '@/utils/apiError'

const rateLimited = (headers = {}) => ({ response: { status: 429, data: {}, headers } })

describe('handleApiError 429', () => {
  test('reads Retry-After and says when the API takes requests again', () => {
    const err = handleApiError(rateLimited({ 'retry-after': '90' }), 'fetching devices')
    expect(err).toMatchObject({ type: 'RATE_LIMIT', retryAfter: 90, isRecoverable: true })
    expect(err.userMessage).toMatch(/again in 2 minutes/)
    expect(handleApiError(rateLimited({ 'retry-after': '1' })).userMessage).toMatch(/again in 1 second\./)
  })

  test('without Retry-After it still reads as a short wait', () => {
    const err = handleApiError(rateLimited())
    expect(err.retryAfter).toBeNull()
    expect(err.userMessage).toMatch(/wait a moment/)
  })
})
