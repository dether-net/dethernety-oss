<script setup lang="ts">
  import { ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { Control, Model } from '@dethernety/dt-core'

  const router = useRouter()

  const features = ref<{
    title: string
    description: string
    icon: string
    function: Function
    action: string
    params?: string
  }[]>([
    {
      title: 'Data Flow Models',
      description: 'Create data flow diagrams to visualize data flow.',
      icon: 'mdi-vector-polyline',
      function: () => {
        showContentSelectDialog.value = true
        contentType.value = 'Model'
      },
      action: 'Open Model',
    },
    {
      title: 'Control Catalog',
      description: 'Implement security controls to mitigate risks.',
      icon: 'mdi-shield-sword-outline',
      function: () => {
        contentType.value = 'Control'
        showContentSelectDialog.value = true
      },
      action: 'Open Control',
    },
    {
      title: 'Issues',
      description: 'View and manage your issues.',
      icon: 'mdi-alert-outline',
      function: () => {
        router.push({ path: '/issues' })
      },
      action: 'Manage Issues',
    },
    {
      title: 'Modules',
      description: 'Configure and manage the system modules.',
      icon: 'mdi-toy-brick-outline',
      function: () => {
        router.push({ path: '/modules', query: { action: 'configureModules' } })
      },
      action: 'Configure Modules',
    },
  ])

  const showContentSelectDialog = ref(false)
  const contentType = ref<'Control' | 'Model' | null>(null)
  const showControlDialog = ref(false)
  const selectedControlId = ref<string | null>(null)

  const onSelectContent = (selectedModels: Model[], selectedControls: Control[]) => {
    showContentSelectDialog.value = false
    if (contentType.value === 'Control') {
      selectedControlId.value = selectedControls[0]?.id ?? null
      showControlDialog.value = true
    } else if (contentType.value === 'Model') {
      router.push({ path: '/dataflow', query: { id: selectedModels[0]?.id } })
    }
  }
</script>

<template>
  <v-container class="pa-15" fluid>
    <!-- Hero Banner -->
    <v-row>
      <v-sheet
        class="hero-banner elevation-12 mb-4"
        height="400"
        rounded="lg"
        style="position: relative; overflow: hidden;"
      >
        <v-img
          alt="Cybersecurity"
          class="banner-image"
          cover
          gradient="to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0.7)"
          height="100%"
          src="/img/main.jpg"
          style="position: absolute; top: 0; left: 0;"
          width="100%"
        />
        <div
          class="d-flex flex-column align-center justify-center text-center mt-10 pt-10"
          style="position: relative; z-index: 1; height: 100%; color: white;"
        >
          <span class="title text-h3 pt-10 mt-10 display-2 font-weight-bold">
            <!-- <v-icon class="title-icon" color="primary">mdi-circle-outline</v-icon> -->
            dethernety
          </span>
          <span class="display-2 font-weight-bold mb-5">dether.net</span>
          <p class="headline mb-4">
            de-threat your security posture with intelligent threat analysis.
          </p>
          <v-row>
            <v-col cols="auto">
              <v-btn color="primary" large prepend-icon="mdi-file-tree-outline" @click="router.push({ path: '/browser' })">
                Browse Content
              </v-btn>
            </v-col>
          </v-row>
        </div>
      </v-sheet>
    </v-row>

    <!-- Feature Cards Section -->
    <v-row class="mx-6" justify="center">
      <v-col v-for="(item, index) in features" :key="index" cols="12" md="3">
        <v-card class="pa-4 opacity-90 feature-card elevation-12" height="100%" outlined>
          <v-card-title class="feature-card-title">
            <v-sheet class="feature-card-title-sheet" height="50px">
              <v-icon class="mb-3 pr-6" color="primary" size="35">{{ item.icon }}</v-icon>
              <span class="text-h5">{{ item.title }}</span>
            </v-sheet>
          </v-card-title>
          <v-card-text class="feature-card-text">
            <v-sheet class="feature-card-description-sheet" height="50px">
              <p class="mb-4">{{ item.description }}</p>
            </v-sheet>
          </v-card-text>
          <v-card-actions class="feature-card-actions d-flex justify-center align-center">
            <v-btn
              class="w-100"
              color="primary"
              variant="flat"
              @click="item.function"
            >
              {{ item.action }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>

  <ContentSelectDialog
    v-if="showContentSelectDialog"
    :content-type="contentType ?? 'Both'"
    select-type="single"
    :show="showContentSelectDialog"
    @close="showContentSelectDialog = false"
    @select="onSelectContent"
  />

  <ControlDialog
    v-if="showControlDialog && selectedControlId !== null"
    :id="selectedControlId ?? ''"
    :show="showControlDialog && selectedControlId !== null"
    :show-file-actions="false"
    @control:closed="showControlDialog = false; selectedControlId = null"
  />
</template>

<style scoped>

:deep(.banner-image .v-img__img--cover) {
  object-position: center 65% !important;
}

.hero-banner {
  background-color: #363640;
  width: 100%;
}

.title {
  font-family: 'JetBrains Mono', monospace !important;
  z-index: 1000;
}

.feature-card-content {
  min-height: 12cap;
}
.feature-card {
  min-height: 18cap;
}

.title-icon {
  margin-right: -79px;
  margin-top: -10px;
  z-index: -1;
}
</style>
