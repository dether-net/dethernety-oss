<script setup lang="ts">
import { useAuthStore } from '@/stores/authStore'
import { onMounted, ref } from 'vue'

const authStore = useAuthStore()
const errorMessage = ref('')

onMounted(async () => {
  try {
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')
    const state = urlParams.get('state')
    const error = urlParams.get('error')
    
    if (error) {
      const oauthErrors: Record<string, string> = {
        'invalid_request': 'The authentication request was invalid.',
        'unauthorized_client': 'This application is not authorized.',
        'access_denied': 'Access was denied.',
        'unsupported_response_type': 'Unsupported authentication method.',
        'invalid_scope': 'The requested permissions are invalid.',
        'server_error': 'The authentication server encountered an error.',
        'temporarily_unavailable': 'The authentication server is temporarily unavailable.',
      }
      errorMessage.value = oauthErrors[error] || 'Authentication failed. Please try again.'
      return
    }
    
    if (!code) {
      errorMessage.value = 'No authorization code received'
      return
    }
    
    await authStore.handleCallback(code, state || undefined)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Authentication failed'
  }
})
</script>

<template>
  <div class="d-flex justify-center align-center" style="min-height: 100vh;">
    <div class="text-center">
      <div v-if="authStore.isLoading && !errorMessage">
        <v-progress-circular indeterminate size="64" class="mb-4"></v-progress-circular>
        <h2>Processing authentication...</h2>
        <p>Please wait while we complete your login.</p>
      </div>
      
      <div v-else-if="errorMessage" class="error-container">
        <v-icon color="error" size="64" class="mb-4">mdi-alert-circle</v-icon>
        <h2 class="text-error mb-4">Authentication Failed</h2>
        <p class="mb-4">{{ errorMessage }}</p>
        <v-btn color="primary" @click="$router.push('/login')">
          Try Again
        </v-btn>
      </div>
      
      <div v-else>
        <v-icon color="success" size="64" class="mb-4">mdi-check-circle</v-icon>
        <h2 class="text-success mb-4">Authentication Successful</h2>
        <p>Redirecting you to the application...</p>
      </div>
    </div>
  </div>
</template>