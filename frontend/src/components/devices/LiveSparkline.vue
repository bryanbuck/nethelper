<template>
  <div class="live-sparkline" :style="{ width: `${width}px`, height: `${height}px` }">
    <svg
      v-if="points.length > 1"
      :width="width"
      :height="height"
      role="img"
      :aria-label="ariaLabel"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
      <line class="baseline" :x1="0" :x2="width" :y1="height - 1" :y2="height - 1" />
      <polyline class="line" :points="path" />
      <circle
        v-if="hover !== null"
        class="marker"
        :cx="coords[hover].x"
        :cy="coords[hover].y"
        r="4"
      />
    </svg>
    <span v-else class="text-caption text-medium-emphasis">collecting…</span>
    <div
      v-if="hover !== null"
      class="tip text-caption"
      :style="{ left: `${Math.min(coords[hover].x, width - 90)}px` }"
    >
      {{ format(points[hover].bps) }} · {{ time(points[hover].at) }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

// One series (total throughput of one port), so no legend: the table column
// names it. Values are real samples only; fewer than two points renders text.
const props = defineProps({
  points: { type: Array, default: () => [] }, // [{ at, bps }]
  width: { type: Number, default: 120 },
  height: { type: Number, default: 28 },
  format: { type: Function, default: (v) => String(v) },
  label: { type: String, default: 'Throughput' },
})

const hover = ref(null)
const PAD = 4

const coords = computed(() => {
  const n = props.points.length
  const max = Math.max(1, ...props.points.map((p) => p.bps))
  const h = props.height - PAD * 2
  return props.points.map((p, i) => ({
    x: n > 1 ? PAD + (i * (props.width - PAD * 2)) / (n - 1) : PAD,
    y: PAD + h - (p.bps / max) * h,
  }))
})

const path = computed(() => coords.value.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '))

const ariaLabel = computed(() => {
  const last = props.points[props.points.length - 1]
  return last ? `${props.label}, latest ${props.format(last.bps)}` : props.label
})

function onMove(event) {
  const x = event.offsetX
  let best = 0
  coords.value.forEach((c, i) => {
    if (Math.abs(c.x - x) < Math.abs(coords.value[best].x - x)) best = i
  })
  hover.value = best
}

function time(at) {
  return new Date(at).toLocaleTimeString()
}
</script>

<style scoped>
.live-sparkline {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.line {
  fill: none;
  stroke: rgb(var(--v-theme-primary));
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.baseline {
  stroke: rgba(var(--v-border-color), var(--v-border-opacity));
  stroke-width: 1;
}

.marker {
  fill: rgb(var(--v-theme-primary));
  stroke: rgb(var(--v-theme-surface));
  stroke-width: 2;
}

.tip {
  position: absolute;
  bottom: 100%;
  white-space: nowrap;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  pointer-events: none;
  z-index: 1;
}
</style>
