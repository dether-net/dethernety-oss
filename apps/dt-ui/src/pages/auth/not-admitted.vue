<script setup lang="ts">
/**
 * The sign-in worked and the deployment refused the account.
 *
 * Reached from the Apollo error link only when a token the identity provider has
 * just issued is refused: a refusal of the token the browser already held is first
 * answered with a refresh and one retry, because an expired session looks the
 * same from here (see utils/deploymentRefusal and plugins/refusalHandler). It is
 * its own page rather than a banner over the app, because the app behind it
 * cannot load anything — every gated query fails the same way — and a page of
 * empty lists with "try again" in each is what this replaces. And it is NOT
 * the login page: a redirect there would go silently through the identity
 * provider, come back with an equally current token, and loop.
 *
 * It says who to ask, because nothing on this deployment can let the person
 * in: who may sign in is chosen by an administrator of the team the
 * deployment belongs to, on the deployment's own console, and takes effect
 * when the platform is restarted.
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const authStore = useAuthStore()
const router = useRouter()

// Which account was refused, so a person with several knows which one to ask about — or to sign out of.
const account = computed(() => authStore.user?.email || authStore.user?.name || '')

async function signOut() {
  await authStore.logout(true)
}

// After an administrator has added the account and restarted the platform, the same token is admitted.
function checkAgain() {
  router.push('/')
}
</script>

<template>
  <div class="d-flex justify-center align-center" style="min-height: 100vh;">
    <div class="text-center not-admitted" data-not-admitted>
      <v-icon color="warning" size="64" class="mb-4">mdi-account-cancel</v-icon>
      <h2 class="mb-4">This deployment does not admit your account</h2>
      <p class="mb-2">
        Your sign-in worked<template v-if="account"> as <strong data-not-admitted-account>{{ account }}</strong></template>,
        but this deployment is not set up to let that account in.
      </p>
      <p class="mb-6">
        Who may sign in is chosen by an administrator of the team this deployment belongs to, on the
        deployment's console. Ask them to add you — the change takes effect when the platform is
        restarted — then check again.
      </p>
      <div class="d-flex justify-center ga-3">
        <!-- SECONDARY, NOT PRIMARY. In the dark theme `primary` is the near-background teal meant for
             header banners, and as a button on this page it all but disappeared. `secondary` is the
             readable teal the app uses for every actionable control on a dark surface. -->
        <v-btn color="secondary" data-not-admitted-check @click="checkAgain">Check again</v-btn>
        <v-btn color="secondary" variant="outlined" data-not-admitted-sign-out @click="signOut">Sign out</v-btn>
      </div>
    </div>
  </div>
</template>

<style scoped>
.not-admitted {
  max-width: 34rem;
  padding: 0 1.5rem;
}
</style>
