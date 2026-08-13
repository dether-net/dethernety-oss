<script setup lang="ts">
import { ref } from 'vue'
import { beginSignIn, consoleRedirectUri, type OidcConfig } from '@/auth'

// The cloud sign-in card. Shown only in cloud posture with no live session; local posture never renders
// it (the console mints a session with no credential and opens straight to the dashboard). Sign-in is the
// PKCE the console already implements — the same flow CloudPanel's refresh uses — landing back on
// /auth/callback where App completes the exchange and mints the session.
const props = defineProps<{ oidc: OidcConfig }>()

const error = ref('')
const busy = ref(false)

async function signIn() {
  error.value = ''
  busy.value = true
  try {
    const url = await beginSignIn(props.oidc, consoleRedirectUri())
    // Leaves the page for the Cognito hosted UI; the return lands on /auth/callback (handled in App).
    window.location.assign(url)
  } catch (e) {
    // A failure here is local (e.g. no secure context) — beginSignIn threw before any redirect.
    error.value = e instanceof Error ? e.message : 'sign-in failed'
    busy.value = false
  }
}
</script>

<template>
  <section class="dt-card max-w-md p-8">
    <h2 class="mb-1 font-heading text-base font-semibold text-dt-text">Sign in</h2>
    <p class="mb-3 text-sm text-dt-text-muted">
      This deployment is connected to the cloud. Sign in with your account to manage it.
    </p>
    <button
      type="button"
      :disabled="busy"
      class="rounded-lg bg-dt-secondary px-3 py-1.5 font-heading text-sm text-dt-surface hover:bg-dt-secondary/80 disabled:opacity-50"
      @click="signIn"
    >
      {{ busy ? 'Redirecting…' : 'Sign in with SSO' }}
    </button>
    <p v-if="error" role="alert" class="mt-2 text-sm text-dt-quinary">{{ error }}</p>
  </section>
</template>
