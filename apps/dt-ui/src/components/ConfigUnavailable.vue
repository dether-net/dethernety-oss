<script setup lang="ts">
/**
 * Shown instead of the app when the platform's runtime configuration (GET /config) cannot be read.
 *
 * It is mounted as its own small app, with no plugins installed, so it uses plain markup and its own styles.
 */
import { onMounted, ref } from 'vue'

defineProps<{
  retry: () => void
}>()

const retryButton = ref<HTMLButtonElement | null>(null)

// The only thing to do here: keyboard users land on it.
onMounted(() => retryButton.value?.focus())
</script>

<template>
  <div class="config-unavailable" data-config-unavailable>
    <div class="config-unavailable__body">
      <div role="alert">
        <h1>The platform's configuration is unavailable</h1>
        <p>
          The app could not read its settings from the platform, so it did not start. This is usually brief, for
          example while the platform restarts.
        </p>
        <p>
          Try again in a moment. If it keeps happening, ask whoever runs this deployment to check that the platform is
          running.
        </p>
      </div>
      <button
        ref="retryButton"
        type="button"
        class="config-unavailable__retry"
        data-config-unavailable-retry
        @click="retry()"
      >
        Try again
      </button>
    </div>
  </div>
</template>

<style scoped>
.config-unavailable {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  /* The dark theme's `background` (plugins/vuetify.ts). */
  background: #2d3748;
  color: rgba(255, 255, 255, 0.87);
  font-family: Roboto, sans-serif;
}

.config-unavailable__body {
  max-width: 34rem;
  padding: 0 1.5rem;
  text-align: center;
}

.config-unavailable__body h1 {
  margin-bottom: 1rem;
  font-size: 1.5rem;
  font-weight: 500;
}

.config-unavailable__body p {
  margin-bottom: 0.75rem;
}

/* The dark theme's `secondary` (plugins/vuetify.ts): the readable teal the app uses for actionable controls on a dark
   surface. */
.config-unavailable__retry {
  margin-top: 0.75rem;
  padding: 0.5rem 1.25rem;
  border: 0;
  border-radius: 4px;
  background: #2a9d8f;
  color: #fff;
  font: inherit;
  cursor: pointer;
}

.config-unavailable__retry:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
</style>
