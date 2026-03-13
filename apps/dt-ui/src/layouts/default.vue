<script setup lang="ts">
  import { useRouter } from 'vue-router'
  import { useAnalysisStore } from '@/stores/analysisStore'
  import { useIssueStore } from '@/stores/issueStore'
  import { useAuthStore } from '@/stores/authStore'
  import { getConfig, getConfigSync, FrontendConfig } from '@/config/environment'

  const drawer = ref(true)
  const rail = ref(true)
  const theme = ref('dark')
  const route = useRoute()
  const router = useRouter()
  const analysisStore = useAnalysisStore()
  const issueStore = useIssueStore()
  const authStore = useAuthStore()
  const config = ref<FrontendConfig | null>(getConfigSync())
  const configLoading = ref(true)
  const configError = ref<string | null>(null)

  function goToHome () {
    window.location.href = '/'
  }

  const mainContentClass = computed(() => {
    if (route.path.startsWith('/dataflow')) {
      return 'main-content no-background'
    } else {
      return 'main-content'
    }
  })

  // Load config asynchronously without making the component async
  onMounted(async () => {
    try {
      if (!config.value) {
        config.value = await getConfig()
      }
    } catch (error) {
      configError.value = error instanceof Error ? error.message : 'Failed to load configuration'
      console.error('Configuration loading error:', error)
    } finally {
      configLoading.value = false
    }
  })

  analysisStore.fetchAnalysisClasses({ classType: 'model_analysis' })
  issueStore.fetchIssueClasses({})
  authStore.refreshTokenIfNeeded()
</script>

<template>
  <v-app :theme="theme">
    <!-- Navigation Drawer -->
    <v-navigation-drawer
      v-model="drawer"
      app
      expand-on-hover
      :rail="rail"
    >
      <!-- Drawer Content -->
      <v-list-item
        class="pa-4"
        nav
        prepend-icon="mdi-account-outline"
        :title="(authStore.user && 'name' in authStore.user) ? (authStore.user as any).name : 'User'"
      >
        <template #append>
          <v-icon 
            v-if="config?.userProfileUrl" 
            class="mr-2 text-medium-emphasis"
            icon="mdi-open-in-new" 
            size="small" 
            target="_blank"
            :href="config?.userProfileUrl"
          />
          <v-btn
            icon="mdi-logout"
            color="error"
            variant="text"
            @click="router.push('/auth/logout')"
          />
          <!-- <v-btn
            :icon="rail ? 'mdi-pin-off-outline' : 'mdi-pin-outline'"
            variant="text"
            @click.stop="rail = !rail"
          /> -->
        </template>
      </v-list-item>

      <v-divider />

      <v-list density="compact" nav>
        <v-list-item prepend-icon="mdi-home-outline" title="Home" :to="{ name: 'home' }" value="home" />
        <v-list-item prepend-icon="mdi-file-tree-outline" title="Browser" :to="{ name: 'browser' }" value="browser" />
        <v-list-item prepend-icon="mdi-alert-outline" title="Issues" :to="{ name: 'issues' }" value="issues" />
        <v-list-item prepend-icon="mdi-toy-brick-outline" title="Modules" :to="{ name: 'modules' }" value="modules" />
      </v-list>
    </v-navigation-drawer>

    <!-- App Bar -->
    <v-app-bar app class="app-bar" style="height: 30px;">
      <div class="title page-title text-h5 pa-2 px-5">
        <v-sheet
          class="d-flex flex-row flex-nowrap align-center text-h5 pa-2 ma-2 px-2 pl-2"
          color="transparent"
          height="100%"
          width="30%"
          @click="goToHome"
        >
          <v-img
            alt="dethernety"
            class="mx-0 logo mr-5"
            height="35"
            src="/img/DT.png"
            style="width: 35px; height: 35px;"
          />
          <span class="title-text text-h5">dethernety</span>
        </v-sheet>
      </div>
    </v-app-bar>

    <div v-if="!route.path.startsWith('/dataflow')" class="vignette-overlay" />
    <!-- Main Content -->
    <v-main :class="mainContentClass">
      <router-view />
    </v-main>

    <!-- Vignette Overlay -->
  </v-app>
</template>

<style>
@import '@/styles/main.scss';

/* Ensure the app fills the viewport */
html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
}

/* Main content area */
.main-content {
  z-index: 2 !important;
  background-color: var(--v-background-base);
  background-image: radial-gradient(circle, #7D7D7D 1px, transparent 1px);
  background-size: 20px 20px;
  background-repeat: repeat;
  min-height: calc(100vh - 60px);
}

.main-content.no-background {
  background: none;
}

.app-bar {
  background-color: rgba(255, 255, 255, 0) !important;
  box-shadow: none !important;
  width: 100%;
}

.page-title {
  background: linear-gradient(to right, rgb(var(--v-theme-surface)) 60%, transparent 100%);
  font-family: 'JetBrains Mono', monospace !important;
  width: 30%;
  text-align: left;
  cursor: pointer;
}

.title-text {
  font-family: 'JetBrains Mono', monospace !important;
}

.logo {
  width: 30px !important;
}

.vignette-overlay {
  z-index: 1 !important;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: radial-gradient(
    ellipse at center,
    transparent 0%,
    transparent 30%,
    rgba(0, 0, 0, 0.15) 60%,
    rgba(0, 0, 0, 0.4) 85%,
    rgba(0, 0, 0, 0.6) 100%
  );
  pointer-events: none;
  z-index: 1;
}

</style>
