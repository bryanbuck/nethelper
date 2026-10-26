import { computed, toValue } from 'vue'
import { useDisplay } from 'vuetify'

// Below sm, data tables stack every column of a row into its own line
// (plugins/vuetify.js), so a wide table becomes a very tall card per row.
// Keep only the columns worth a line on a phone; desktop gets them all.
export function usePhoneColumns (headers, keep) {
  const { xs } = useDisplay()
  const keys = new Set(keep)
  return computed(() => {
    const all = toValue(headers)
    return xs.value ? all.filter((h) => keys.has(h.key)) : all
  })
}
