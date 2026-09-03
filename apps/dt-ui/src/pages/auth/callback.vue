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
        <!-- Inline SVG for the same reason as the success glyph below. Built from a
             circle plus an explicit stroke rather than a single MDI-style path,
             whose glyph is knocked out of the disc by fill winding — correct by
             construction here instead of by a rule that is easy to get subtly
             wrong. The knockout colour is the surface token, so it tracks the theme. -->
        <svg class="mb-4" height="64" viewBox="0 0 24 24" width="64">
          <circle cx="12" cy="12" fill="rgb(var(--v-theme-error))" r="10" />
          <path
            d="M12 6.75v6.5"
            fill="none"
            stroke="rgb(var(--v-theme-surface))"
            stroke-linecap="round"
            stroke-width="2.2"
          />
          <circle cx="12" cy="16.75" fill="rgb(var(--v-theme-surface))" r="1.2" />
        </svg>
        <h2 class="text-error mb-4">Authentication Failed</h2>
        <p class="mb-4">{{ errorMessage }}</p>
        <v-btn color="primary" @click="$router.push('/login')">
          Try Again
        </v-btn>
      </div>
      
      <div v-else>
        <!-- Inline SVG, not <v-icon>. This page paints a glyph and then navigates
             away (handleCallback → safeRedirect), which cancels the icon-font
             download mid-flight and leaves the app's next load without it — the
             empty-squares-after-login bug. Nothing here may depend on the webfont. -->
        <svg class="mb-4" height="64" viewBox="0 0 24 24" width="64">
          <circle cx="12" cy="12" fill="rgb(var(--v-theme-success))" r="10" />
          <path
            d="M7.4 12.4l3.1 3.1 6.1-6.1"
            fill="none"
            stroke="rgb(var(--v-theme-surface))"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2.2"
          />
        </svg>
        <h2 class="text-success mb-4">Authentication Successful</h2>
        <p>Redirecting you to the application...</p>
      </div>
    </div>
  </div>
</template>