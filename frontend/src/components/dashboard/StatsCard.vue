<template>
  <!-- With actions, the whole card is the link (the button just labels it) -->
  <v-card 
    class="stats-card" 
    :color="color" 
    :variant="variant"
    elevation="2"
    :link="showActions"
    @click="showActions && $emit('action-click')"
  >
    <!-- On a filled card everything inherits one readable color (contentStyle) -->
    <v-card-text class="d-flex align-center justify-space-between" :style="contentStyle">
      <div>
        <div class="text-h4 font-weight-bold stats-value" :class="valueColor">
          {{ formattedValue }}
        </div>
        <div class="text-subtitle-1 mt-1" :class="filled ? 'stats-secondary' : 'text-medium-emphasis'">
          {{ title }}
        </div>
        <div v-if="trend" class="d-flex align-center mt-2" :class="{ 'stats-secondary': filled }">
          <v-icon 
            :color="filled ? undefined : trendColor" 
            size="small" 
            class="mr-1"
          >
            {{ trendIcon }}
          </v-icon>
          <span 
            class="text-caption font-weight-medium" 
            :class="filled ? undefined : trendColor"
          >
            {{ trendValue }}{{ trendSuffix }} {{ trendLabel }}
          </span>
        </div>
      </div>
      <div class="stats-icon">
        <v-icon 
          :color="filled ? undefined : iconColor" 
          size="48"
        >
          {{ icon }}
        </v-icon>
      </div>
    </v-card-text>
    
    <v-card-actions v-if="showActions" :style="contentStyle">
      <v-btn 
        variant="text" 
        size="small" 
        :color="filled ? 'inherit' : color"
      >
        View Details
        <v-icon end>mdi-arrow-right</v-icon>
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup>
import { computed } from 'vue'
import { useTheme } from 'vuetify'
import { readableOn } from '@/utils/contrast'

const props = defineProps({
  title: {
    type: String,
    required: true
  },
  value: {
    type: [Number, String],
    required: true
  },
  icon: {
    type: String,
    default: 'mdi-chart-line'
  },
  color: {
    type: String,
    default: 'primary'
  },
  variant: {
    type: String,
    default: 'elevated'
  },
  trend: {
    type: String,
    default: 'neutral',
    validator: value => ['up', 'down', 'neutral'].includes(value)
  },
  trendValue: {
    type: [Number, String],
    default: 0
  },
  trendSuffix: {
    type: String,
    default: '%'
  },
  trendLabel: {
    type: String,
    default: 'from last hour'
  },
  showActions: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  }
})

defineEmits(['action-click'])

const theme = useTheme()

// Elevated/flat cards are filled with `color`. Their text must follow the
// fill, not the page: black or white, whichever reads better on this theme's
// fill (the themes' on-* colors and the page text don't, e.g. dark text on
// Classic's blue, white on Dark's yellow).
const filled = computed(() => ['elevated', 'flat'].includes(props.variant))
const contentStyle = computed(() => {
  const fill = filled.value && theme.current.value.colors[props.color]
  return fill ? { color: readableOn(fill) } : undefined
})

const formattedValue = computed(() => {
  if (props.loading) return '...';
  if (typeof props.value === 'number') {
    return props.value.toLocaleString();
  }
  return props.value;
});

const trendIcon = computed(() => {
  switch (props.trend) {
    case 'up': return 'mdi-trending-up'
    case 'down': return 'mdi-trending-down'
    case 'neutral': return 'mdi-trending-neutral'
    default: return 'mdi-minus'
  }
})

const trendColor = computed(() => {
  switch (props.trend) {
    case 'up': return 'text-success'
    case 'down': return 'text-error'
    case 'neutral': return 'text-warning'
    default: return 'text-medium-emphasis'
  }
})

const valueColor = computed(() => {
  if (filled.value) return props.loading ? 'stats-secondary' : undefined
  return props.loading ? 'text-medium-emphasis' : 'text-high-emphasis'
})

const iconColor = computed(() => {
  return props.variant === 'tonal' ? props.color : 'medium-emphasis'
})
</script>

<style scoped>
.stats-card {
  transition: all 0.3s ease;
}

.stats-card:hover {
  transform: translateY(-2px);
}

.stats-value {
  line-height: 1.2;
}

.stats-icon {
  opacity: 0.7;
}

/* Phones show two cards per row: drop the icon, shrink the number. */
@media (max-width: 599.98px) {
  .stats-icon {
    display: none;
  }

  .stats-value {
    font-size: 1.75rem !important;
  }
}

/* Secondary text on a fill: the fill's text color, slightly lighter
   (theme.spec.js checks it stays at least 4.5:1) */
.stats-secondary {
  opacity: 0.92;
}
</style>