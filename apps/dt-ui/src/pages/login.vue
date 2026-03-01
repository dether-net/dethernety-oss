<script setup lang="ts">
import { useAuthStore } from '@/stores/authStore'
import { onMounted, ref, computed } from 'vue'

const authStore = useAuthStore()
const isInitiating = ref(true)

const environmentText = computed(() => {
  return import.meta.env.DEV ? 'Development (HTTP)' : 'Production (HTTPS)'
})

onMounted(async () => {
  try {
    console.log('Login initiated')
    await authStore.login()
  } catch (error) {
    console.error('Login initiation failed:', error)
    isInitiating.value = false
  }
})
</script>

<template>
  <div class="d-flex justify-center align-center" style="min-height: 100vh;">
    <div class="text-center">
      <div v-if="isInitiating && !authStore.error">
        <v-progress-circular indeterminate size="64" class="mb-4"></v-progress-circular>
        <h2>Initiating Login</h2>
        <p>Redirecting you to the authentication provider...</p>
        <p class="text-caption mt-4">
          Environment: {{ environmentText }}
        </p>
      </div>
      
      <div v-else-if="authStore.error" class="error-container">
        <v-icon color="error" size="64" class="mb-4">mdi-alert-circle</v-icon>
        <h2 class="text-error mb-4">Login Failed</h2>
        <p class="mb-4">{{ authStore.error }}</p>
        <v-btn color="primary" @click="$router.push('/')">
          Go Home
        </v-btn>
      </div>
    </div>
  </div>
</template>