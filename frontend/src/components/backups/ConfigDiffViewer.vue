<template>
  <div class="config-diff-viewer">
    <div class="diff-summary d-flex align-center flex-wrap ga-2 mb-2">
      <v-chip color="success" size="small" variant="tonal" prepend-icon="mdi-plus">
        {{ additions }} added
      </v-chip>
      <v-chip color="error" size="small" variant="tonal" prepend-icon="mdi-minus">
        {{ deletions }} removed
      </v-chip>
      <v-chip v-if="identical" color="info" size="small" variant="tonal" prepend-icon="mdi-equal">
        Configurations are identical
      </v-chip>
    </div>

    <div v-if="!patch" class="text-medium-emphasis pa-4 text-center">
      No diff to display.
    </div>

    <div v-else class="diff-scroll">
      <table class="diff-table">
        <tbody>
          <tr
            v-for="(line, index) in parsedLines"
            :key="index"
            :class="`diff-line diff-${line.kind}`"
          >
            <td class="diff-gutter">{{ line.marker }}</td>
            <td class="diff-content">{{ line.text }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  patch: {
    type: String,
    default: ''
  },
  additions: {
    type: Number,
    default: 0
  },
  deletions: {
    type: Number,
    default: 0
  },
  identical: {
    type: Boolean,
    default: false
  }
})

// Classify each line of a unified diff for coloring. We skip the file-header
// lines (---/+++) since they duplicate the metadata shown around the viewer.
const parsedLines = computed(() => {
  if (!props.patch) return []

  return props.patch
    .split('\n')
    .filter(line => !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('==='))
    .map(line => {
      if (line.startsWith('@@')) {
        return { kind: 'hunk', marker: '', text: line }
      }
      if (line.startsWith('+')) {
        return { kind: 'add', marker: '+', text: line.slice(1) }
      }
      if (line.startsWith('-')) {
        return { kind: 'remove', marker: '-', text: line.slice(1) }
      }
      if (line.startsWith('\\')) {
        // "\ No newline at end of file"
        return { kind: 'meta', marker: '', text: line }
      }
      return { kind: 'context', marker: ' ', text: line.startsWith(' ') ? line.slice(1) : line }
    })
})
</script>

<style scoped>
.diff-scroll {
  overflow-x: auto;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  max-height: 60vh;
  overflow-y: auto;
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Roboto Mono', 'Courier New', monospace;
  font-size: 0.8125rem;
  line-height: 1.5;
}

.diff-line td {
  padding: 0 8px;
  white-space: pre;
  vertical-align: top;
}

.diff-gutter {
  width: 1.5rem;
  text-align: center;
  user-select: none;
  opacity: 0.6;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.diff-content {
  width: 100%;
}

/* Light-theme colors; overridden for dark below. Uses rgba so it layers
   correctly over either surface color. */
.diff-add {
  background-color: rgba(76, 175, 80, 0.15);
  color: rgb(27, 94, 32);
}

.diff-remove {
  background-color: rgba(244, 67, 54, 0.15);
  color: rgb(183, 28, 28);
}

.diff-hunk {
  background-color: rgba(33, 150, 243, 0.12);
  color: rgb(21, 101, 192);
  font-weight: 500;
}

.diff-meta {
  opacity: 0.6;
  font-style: italic;
}

:deep(.v-theme--dark) .diff-add,
.v-theme--dark .diff-add {
  color: rgb(129, 199, 132);
}

:deep(.v-theme--dark) .diff-remove,
.v-theme--dark .diff-remove {
  color: rgb(239, 154, 154);
}

:deep(.v-theme--dark) .diff-hunk,
.v-theme--dark .diff-hunk {
  color: rgb(144, 202, 249);
}
</style>
