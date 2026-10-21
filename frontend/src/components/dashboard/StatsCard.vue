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
    <v-card-text class="d-flex align-center justify-space-between">
      <div>
        <div class="text-h4 font-weight-bold stats-value" :class="valueColor">
          {{ formattedValue }}
        </div>
        <div class="text-subtitle-1 text-medium-emphasis mt-1">
          {{ title }}
        </div>
        <div v-if="trend" class="d-flex align-center mt-2">
          <v-icon 
            :color="trendColor" 
            size="small" 
            class="mr-1"
          >
            {{ trendIcon }}
          </v-icon>
          <span 
            class="text-caption font-weight-medium" 
            :class="trendColor"
          >
            {{ trendValue }}{{ trendSuffix }} {{ trendLabel }}
          </span>
        </div>
      </div>
      <div class="stats-icon">
        <v-icon 
          :color="iconColor" 
          size="48"
        >
          {{ icon }}
        </v-icon>
      </div>
    </v-card-text>
    
    <v-card-actions v-if="showActions">
      <v-btn 
        variant="text" 
        size="small" 
        :color="color"
      >
        View Details
        <v-icon end>mdi-arrow-right</v-icon>
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup>
import { computed } from 'vue'

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
</style>