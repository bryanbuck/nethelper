<template>
  <!-- Phones: icon only, so a row of actions stays on one line; the label
       becomes the tooltip and the accessible name. -->
  <v-btn
    v-if="iconOnly"
    v-bind="$attrs"
    icon
    :density="$attrs.density || 'comfortable'"
    :title="$attrs.title || label"
    :aria-label="label"
  >
    <v-badge v-if="badgeContent" :content="badgeContent" color="primary" floating>
      <v-icon :icon="icon" />
    </v-badge>
    <v-icon v-else :icon="icon" />
    <template v-for="name in namedSlots" #[name]="scope" :key="name">
      <slot :name="name" v-bind="scope || {}" />
    </template>
  </v-btn>
  <v-btn v-else v-bind="$attrs" :prepend-icon="icon">
    {{ label }}
    <v-badge v-if="badgeContent" :content="badgeContent" color="primary" inline />
    <template v-for="name in namedSlots" #[name]="scope" :key="name">
      <slot :name="name" v-bind="scope || {}" />
    </template>
  </v-btn>
</template>

<script setup>
import { computed, useSlots } from 'vue'
import { useDisplay } from 'vuetify'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  icon: { type: String, required: true },
  label: { type: String, required: true },
  // A count shown on the button (e.g. active filters); hidden when 0 or empty.
  badge: { type: [Number, String], default: null },
  // Keep the label on a phone too (the page's main action).
  keepLabel: { type: Boolean, default: false },
})

const { xs } = useDisplay()
const slots = useSlots()
const iconOnly = computed(() => xs.value && !props.keepLabel)
// Forwarded as-is (e.g. #loader); the default slot is the label.
const namedSlots = computed(() => Object.keys(slots).filter((name) => name !== 'default'))
const badgeContent = computed(() => props.badge || null)
</script>
