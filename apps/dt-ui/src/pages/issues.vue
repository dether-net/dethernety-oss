<script setup lang="ts">
  import { computed, nextTick, onMounted, ref, watch } from 'vue'
  import { useIssueStore } from '@/stores/issueStore'
  import { Class, Issue } from '@dethernety/dt-core'
  import { LocationQueryRaw, onBeforeRouteLeave, useRouter } from 'vue-router'
  import {
    applyLocalFiltering,
    buildRemoteFilterParams,
    type ParsedSearch,
    parseSearchQuery,
    validateSearchQuery,
  } from '@/utils/issueSearchUtils'
  import IssueCard from '@/components/Dialogs/Issues/IssueCard.vue'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'

  interface SnackBar {
    show: boolean
    message: string
    color: string
  }

  const router = useRouter()

  const issueStore = useIssueStore()
  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })
  const issues = ref<Issue[]>([])
  const allIssues = ref<Issue[]>([])
  const search = ref('')
  const searchError = ref('')
  const isSearching = ref(false)
  const statusStrings = ['identified', 'analyzing', 'mitigating', 'monitored', 'resolved', 'accepted']
  const severityStrings = ['critical', 'high', 'medium', 'low']
  const likelihoodStrings = ['very-high', 'high', 'medium', 'low', 'very-low']
  const expanded = ref<string[]>([])
  const currentOpenPanelId = ref<string | null>(null)
  const showConfirmDeleteDialog = ref(false)
  const issueToDelete = ref<Issue | null>(null)
  const selectedIssueIds = ref<string[]>([])
  const issueStatusFilter = ref<string>('')
  const showSearchHelp = ref(false)

  // Filter selections
  const selectedClass = ref<Class | null>(null)
  const selectedStatuses = ref<string[]>([])
  const selectedSeverities = ref<string[]>([])
  const selectedLikelihoods = ref<string[]>([])

  // Search functionality
  const parsedSearch = computed((): ParsedSearch => {
    if (!search.value.trim()) {
      return { remoteConditions: [], localGroups: [] }
    }
    return parseSearchQuery(search.value)
  })

  const applySearch = () => {
    const parsed = parsedSearch.value

    // Apply local filtering to the fetched issues
    if (parsed.localGroups.length > 0) {
      issues.value = applyLocalFiltering(allIssues.value, parsed.localGroups)
    } else {
      issues.value = allIssues.value
    }
  }

  const performSearch = async () => {
    searchError.value = ''

    // Validate search query
    const validation = validateSearchQuery(search.value)
    if (!validation.valid) {
      searchError.value = validation.error || 'Invalid search syntax'
      return
    }

    try {
      const parsed = parsedSearch.value

      // Perform remote filtering if there are remote conditions
      let fetchedIssues: Issue[]
      if (parsed.remoteConditions.length > 0) {
        const remoteParams = buildRemoteFilterParams(parsed.remoteConditions)
        fetchedIssues = await fetchIssues(remoteParams)
      } else {
        // Fetch all issues if no remote conditions
        fetchedIssues = await fetchIssues({})
      }

      // Store all fetched issues
      allIssues.value = fetchedIssues

      // Apply local filtering
      applySearch()
    } catch (error) {
      console.error('Search error:', error)
      searchError.value = 'Search failed. Please try again.'
      snackBar.value = {
        show: true,
        message: 'Search failed. Please try again.',
        color: 'error',
      }
    }
  }

  const clearSearch = () => {
    search.value = ''
    searchError.value = ''
    clearAllFilters()
    // Don't automatically add default filter when clearing
    performSearch()
  }

  const initializeDefaultSearch = () => {
    // Only add default filter if search is empty
    if (!search.value.trim()) {
      search.value = 'issueStatus:"open"'
    }
  }

  const clearAllFilters = () => {
    selectedClass.value = null
    issueStatusFilter.value = ''
    selectedStatuses.value = []
    selectedSeverities.value = []
    selectedLikelihoods.value = []
  }

  const buildSearchFromFilters = (): string => {
    const parts: string[] = []

    // Remote filters
    if (selectedClass.value) {
      parts.push(`classId:"${selectedClass.value.id}"`)
    }

    if (issueStatusFilter.value) {
      parts.push(`issueStatus:"${issueStatusFilter.value}"`)
    }

    // Local filters (in parentheses with AND relation)
    const localConditions: string[] = []

    if (selectedStatuses.value.length > 0) {
      if (selectedStatuses.value.length === 1) {
        localConditions.push(`status:"${selectedStatuses.value[0]}"`)
      } else {
        const statusOr = selectedStatuses.value.map(s => `status:"${s}"`).join(' OR ')
        localConditions.push(`(${statusOr})`)
      }
    }

    if (selectedSeverities.value.length > 0) {
      if (selectedSeverities.value.length === 1) {
        localConditions.push(`severity:"${selectedSeverities.value[0]}"`)
      } else {
        const severityOr = selectedSeverities.value.map(s => `severity:"${s}"`).join(' OR ')
        localConditions.push(`(${severityOr})`)
      }
    }

    if (selectedLikelihoods.value.length > 0) {
      if (selectedLikelihoods.value.length === 1) {
        localConditions.push(`likelihood:"${selectedLikelihoods.value[0]}"`)
      } else {
        const likelihoodOr = selectedLikelihoods.value.map(l => `likelihood:"${l}"`).join(' OR ')
        localConditions.push(`(${likelihoodOr})`)
      }
    }

    // Combine local conditions with AND
    if (localConditions.length > 0) {
      const localQuery = localConditions.join(' AND ')
      parts.push(`(${localQuery})`)
    }

    return parts.join(' ')
  }

  const updateSearchFromFilters = () => {
    const filterQuery = buildSearchFromFilters()

    // Preserve any existing manual search terms
    const currentSearch = search.value.trim()
    if (currentSearch && !isFilterGeneratedSearch(currentSearch)) {
      // If there's existing manual search, combine with filters
      search.value = filterQuery ? `${currentSearch} ${filterQuery}` : currentSearch
    } else {
      // Replace with filter-generated search
      search.value = filterQuery
    }
  }

  const isFilterGeneratedSearch = (searchQuery: string): boolean => {
    // Simple heuristic to detect if search was generated by filters
    // This helps preserve manual search terms when filters change
    return searchQuery.includes('classId:') ||
      searchQuery.includes('issueStatus:') ||
      (searchQuery.includes('status:') && searchQuery.includes('(')) ||
      (searchQuery.includes('severity:') && searchQuery.includes('(')) ||
      (searchQuery.includes('likelihood:') && searchQuery.includes('('))
  }

  // Watchers
  watch(
    () => issueStore.issues,
    newIssues => {
      allIssues.value = newIssues
      applySearch()
    },
    { immediate: true }
  )

  watch(expanded, newVal => {
    if (!newVal || (Array.isArray(newVal) && newVal.length === 0)) {
      currentOpenPanelId.value = null
      return
    }

    nextTick(() => {
      const targetId = Array.isArray(newVal) ? newVal[newVal.length - 1] : newVal
      currentOpenPanelId.value = targetId

      setTimeout(() => {
        const panelId = `issue-${targetId}`
        const panel = document.getElementById(panelId)
        if (!panel) return

        panel.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 300)
    })
  })

  const fetchIssueClasses = async () => {
    const issueClasses = await issueStore.fetchIssueClasses({})
    if (!issueClasses) {
      snackBar.value.show = true
      snackBar.value.message = 'Failed to fetch issue classes'
      snackBar.value.color = 'error'
    }
  }

  const fetchIssues = async (remoteParams: Record<string, any> = {}) => {
    isSearching.value = true
    try {
      const result = await issueStore.fetchIssues(remoteParams)
      if (!result) {
        snackBar.value.show = true
        snackBar.value.message = 'Failed to fetch issues'
        snackBar.value.color = 'error'
        return []
      }
      return result
    } finally {
      isSearching.value = false
    }
  }

  const refresh = () => {
    fetchIssueClasses()
    initializeDefaultSearch()
    performSearch()
    selectedIssueIds.value = []
  }

  const deleteIssue = () => {
    if (issueToDelete.value && issueToDelete.value.id) {
      issueStore.deleteIssue(issueToDelete.value.id)
      showConfirmDeleteDialog.value = false
      issueToDelete.value = null
    }
  }

  const createIssue = (issueClass: Class, name?: string, description?: string, comments?: string[], elementIds?: string[]) => {
    const issue: Issue = {
      name: name || `New ${issueClass.name} Issue`,
      issueClass,
      id: '',
      description: description || '',
      type: issueClass.type || '',
      category: issueClass.category || '',
      createdAt: '',
      updatedAt: '',
      attributes: '',
      comments: comments || [],
    }
    issueStore.createIssue(issue).then(result => {
      if (result) {
        if (elementIds) {
          issueStore.addElementsToIssue({ issueId: result.id, elementIds }).then(() => {
            performSearch()
          })
        }
        expanded.value = [result.id]
        performSearch()
      }
    })
  }

  const mergeIssues = (issueClass: Class) => {
    const comments: string[] = []
    const elementIds: string[] = []
    for (const issueId of selectedIssueIds.value) {
      const issue = issueStore.getIssueById(issueId)
      if (issue) {
        const newIssue: Issue = {
          ...issue,
          issueStatus: 'closed',
        }
        issueStore.updateIssue(newIssue)
        if (issue.elements && Array.isArray(issue.elements)) {
          elementIds.push(...issue.elements.map((element: any) => element.id))
        }
        comments.push(`Comments from ${issue.name}`)
        if (issue.comments && Array.isArray(issue.comments)) {
          comments.push(...issue.comments)
        }
      }
    }
    createIssue(
      issueClass,
      `New ${issueClass.name} Issue from ${selectedIssueIds.value.length} issues`,
      `Merged issues: \n- ${selectedIssueIds.value.map(id => issueStore.getIssueById(id)?.name).join('\n - ')}`,
      comments,
      elementIds,
    )
    selectedIssueIds.value = []
  }

  const navigateToElement = (path: string, query: LocationQueryRaw) => {
    router.push({ path, query })
  }

  const setIssueStatusFilter = (status: string) => {
    // Remove existing issueStatus filter and add new one
    search.value = search.value.replace(/issueStatus:["'][^"']*["']/g, '').trim()
    if (status) {
      search.value = search.value ? `${search.value} issueStatus:"${status}"` : `issueStatus:"${status}"`
    }
  }

  const removeIssueStatusFilter = () => {
    search.value = search.value.replace(/issueStatus:["'][^"']*["']/g, '').trim()
  }

  // Computed properties for issue status detection
  const hasIssueStatusFilter = computed(() => search.value.includes('issueStatus:'))
  const hasOpenFilter = computed(() => search.value.includes('issueStatus:"open"'))
  const hasClosedFilter = computed(() => search.value.includes('issueStatus:"closed"'))

  // Watch for search changes with debounce
  let searchTimeout: ReturnType<typeof setTimeout> | undefined
  watch(search, newValue => {
    if (searchTimeout) {
      clearTimeout(searchTimeout)
    }
    searchTimeout = setTimeout(() => {
      if (newValue.trim()) {
        performSearch()
      } else {
        clearSearch()
      }
    }, 500)
  })

  // Watch for filter changes and update search
  watch([selectedClass, issueStatusFilter, selectedStatuses, selectedSeverities, selectedLikelihoods], () => {
    updateSearchFromFilters()
  }, { deep: true })

  onMounted(() => {
    fetchIssueClasses()
    initializeDefaultSearch()
    if (issueStore.getIssueDataClipboard()) {
      snackBar.value.show = true
      snackBar.value.message = 'Select an issue to add the data'
      snackBar.value.color = 'success'
    }
  })

  onBeforeRouteLeave(() => {
    issueStore.resetIssue()
  })

  const toggleSelectedIssue = (issueId: string) => {
    if (selectedIssueIds.value.includes(issueId)) {
      selectedIssueIds.value = selectedIssueIds.value.filter(id => id !== issueId)
    } else {
      selectedIssueIds.value.push(issueId)
    }
  }
</script>

<template>
  <!-- eslint-disable vue/no-lone-template -->
  <v-container class="pa-0 ma-0" fluid>
    <v-row>
      <v-col cols="12">
        <v-card class="mx-5 mt-2 mb-2 pa-0 rounded-lg" color="background">
          <v-card-title
            class="ma-0 pa-0 mb-2"
            color="background"
            density="compact"
            variant="flat"
          >
            <v-sheet class="d-flex align-center justify-space-between border-b-thin align-row px-2" color="transparent" height="30">
              <v-menu class="mx-2 py-2">
                <template #activator="{ props: activatorProps }">
                  <v-icon color="secondary" icon="mdi-magnify" size="x-small" />
                  <v-btn
                    v-bind="activatorProps"
                    :color="selectedClass ? 'tertiary' : 'secondary'"
                    size="small"
                    :variant="selectedClass ? 'tonal' : 'text'"
                  >Class</v-btn>
                </template>
                <v-list>
                  <v-list-item @click="selectedClass = null">
                    <v-list-item-title class="text-color">
                      <v-checkbox
                        class="ml-1 mr-3 my-0 pa-0"
                        color="tertiary"
                        density="compact"
                        hide-details
                        label="All Classes"
                        :model-value="!selectedClass"
                        readonly
                      />
                    </v-list-item-title>
                  </v-list-item>
                  <v-list-item v-for="issueClass in issueStore.issueClasses" :key="issueClass.id" @click="selectedClass = issueClass">
                    <v-list-item-title class="text-color">
                      <v-checkbox
                        class="ml-1 mr-3 my-0 pa-0"
                        color="tertiary"
                        density="compact"
                        hide-details
                        :label="issueClass.name"
                        :model-value="selectedClass?.id === issueClass.id"
                        readonly
                      />
                    </v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
              <v-menu class="mx-2">
                <template #activator="{ props: activatorProps }">
                  <v-btn
                    v-bind="activatorProps"
                    :color="hasIssueStatusFilter ? 'tertiary' : 'secondary'"
                    size="small"
                    :variant="hasIssueStatusFilter ? 'tonal' : 'text'"
                  >Issue Status</v-btn>
                </template>
                <v-list>
                  <v-list-item @click="removeIssueStatusFilter()">
                    <v-list-item-title class="text-color">
                      <v-checkbox
                        class="ml-1 mr-3 my-0 pa-0"
                        color="tertiary"
                        density="compact"
                        hide-details
                        label="All Issues"
                        :model-value="!hasIssueStatusFilter"
                        readonly
                      />
                    </v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="setIssueStatusFilter('open')">
                    <v-list-item-title class="text-color">
                      <v-checkbox
                        class="ml-1 mr-3 my-0 pa-0"
                        color="tertiary"
                        density="compact"
                        hide-details
                        label="Open Issues"
                        :model-value="hasOpenFilter"
                        readonly
                      />
                    </v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="setIssueStatusFilter('closed')">
                    <v-list-item-title class="text-color">
                      <v-checkbox
                        class="ml-1 mr-3 my-0 pa-0"
                        color="tertiary"
                        density="compact"
                        hide-details
                        label="Closed Issues"
                        :model-value="hasClosedFilter"
                        readonly
                      />
                    </v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
              <v-menu class="mx-2">
                <template #activator="{ props: activatorProps }">
                  <v-btn
                    v-bind="activatorProps"
                    :color="selectedStatuses.length > 0 ? 'tertiary' : 'secondary'"
                    size="small"
                    :variant="selectedStatuses.length > 0 ? 'tonal' : 'text'"
                  >Status</v-btn>
                </template>
                <v-list>
                  <v-list-item v-for="status in statusStrings" :key="status" @click.stop>
                    <v-list-item-title class="text-color text-capitalize">
                      <v-checkbox
                        v-model="selectedStatuses"
                        class="ml-1 mr-3 my-0 pa-0"
                        color="tertiary"
                        density="compact"
                        hide-details
                        :label="status"
                        :value="status"
                        @click.stop
                      />
                    </v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
              <v-menu class="mx-2">
                <template #activator="{ props: activatorProps }">
                  <v-btn
                    v-bind="activatorProps"
                    :color="selectedSeverities.length > 0 ? 'tertiary' : 'secondary'"
                    size="small"
                    :variant="selectedSeverities.length > 0 ? 'tonal' : 'text'"
                  >Severity</v-btn>
                </template>
                <v-list>
                  <v-list-item v-for="severity in severityStrings" :key="severity" @click.stop>
                    <v-list-item-title class="text-color text-capitalize">
                      <v-checkbox
                        v-model="selectedSeverities"
                        class="ml-1 mr-3 my-0 pa-0"
                        color="tertiary"
                        density="compact"
                        hide-details
                        :label="severity"
                        :value="severity"
                        @click.stop
                      />
                    </v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
              <v-menu class="mx-2">
                <template #activator="{ props: activatorProps }">
                  <v-btn
                    v-bind="activatorProps"
                    :color="selectedLikelihoods.length > 0 ? 'tertiary' : 'secondary'"
                    size="small"
                    :variant="selectedLikelihoods.length > 0 ? 'tonal' : 'text'"
                  >Likelihood</v-btn>
                </template>
                <v-list>
                  <v-list-item v-for="likelihood in likelihoodStrings" :key="likelihood" @click.stop>
                    <v-list-item-title class="text-color text-capitalize">
                      <v-checkbox
                        v-model="selectedLikelihoods"
                        class="ml-1 mr-3 my-0 pa-0"
                        color="tertiary"
                        density="compact"
                        hide-details
                        :label="likelihood"
                        :value="likelihood"
                        @click.stop
                      />
                    </v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
              <v-spacer />
              <v-btn
                class="mr-2 elevation-0"
                color="secondary"
                icon="mdi-filter-remove"
                size="small"
                variant="text"
                @click="clearAllFilters"
              />
              <v-btn
                class="mr-2 elevation-0"
                color="secondary"
                icon="mdi-refresh"
                size="small"
                variant="text"
                @click="refresh"
              />
              <v-btn
                class="mr-2 elevation-0"
                color="secondary"
                icon="mdi-help"
                size="small"
                variant="text"
                @click="showSearchHelp = !showSearchHelp"
              />
            </v-sheet>
          </v-card-title>
          <v-card-text class="py-0 pt-2">
            <div class="d-flex align-center justify-start flex-column w-100 px-5">
              <v-text-field
                v-model="search"
                class="ma-0 pa-0 w-100"
                clearable
                :error="!!searchError"
                :error-messages="searchError"
                label="Search (e.g., name:'Threat Vector' (id:123 OR type:security))"
                :loading="isSearching"
                prepend-inner-icon="mdi-magnify"
                @click:clear="clearSearch"
              />

              <v-expand-transition>
                <v-card
                  v-if="showSearchHelp"
                  class="mt-2 mb-5 w-100"
                  variant="tonal"
                >
                  <v-card-text class="pa-3">
                    <div class="text-body-2">
                      <strong>Search Syntax:</strong><br>
                      ▷ <strong>Remote filtering:</strong> key:value (no operators)<br>
                      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Available keys: name, issueId, classId, elementIds, classType, moduleId, moduleName, issueStatus<br>
                      ▷ <strong>Local filtering:</strong> (key:value AND/OR key:value)<br>
                      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Available keys: id, name, description, type, category, open, class.name, class.type, etc.<br>
                      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Custom attributes: any key from syncedAttributes (searches deeply in nested objects)<br><br>
                      <strong>Filter Menus:</strong><br>
                      Use the filter buttons above to quickly add search conditions.<br>
                      ▷ <strong>Class, Issue Status:</strong> Remote filters (server-side)<br>
                      ▷ <strong>Status, Severity, Likelihood:</strong> Local filters (client-side, combined with AND)<br>
                      ▷ <strong>Default:</strong> Shows open issues by default<br><br>
                      <strong>Examples:</strong><br>
                      ▷ <code>name:'Security Issue'</code><br>
                      ▷ <code>issueStatus:open</code> (remote filter for open issues)<br>
                      ▷ <code>issueStatus:closed</code> (remote filter for closed issues)<br>
                      ▷ <code>(type:threat AND category:high)</code><br>
                      ▷ <code>(severity:high)</code> (searches deep in the attributes)<br>
                      ▷ <code>(attributes.severity:high)</code> (direct nested path)<br>
                      ▷ <code>classType:vulnerability (name:SQL OR description:injection)</code>
                    </div>
                  </v-card-text>
                </v-card>
              </v-expand-transition>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-row>
      <v-col class="pa-0 px-10 ma-0 position-relative" cols="12">
        <v-sheet class="position-absolute top-0 right-0 mt-2 mb-1 actions-container" color="transparent" style="z-index: 1000;">
          <v-speed-dial
            id="merge-issues"
            key="merge-issues"
            location="bottom left"
            transition="slide-y-transition"
          >
            <template #activator="{ props: activatorProps }">
              <v-fab
                v-bind="activatorProps"
                class="ma-0 mr-2"
                color="tertiary"
                :disabled="selectedIssueIds.length < 2"
                elevation="12"
                icon="mdi-link-variant"
                size="x-large"
                variant="outlined"
              />
            </template>
            <v-btn
              v-for="issueClass in issueStore.issueClasses"
              :key="issueClass.id"
              class="issue-link-class-btn"
              color="tertiary"
              elevation="12"
              size="large"
              variant="plain"
              @click="mergeIssues(issueClass)"
            >
              <span class="text-color">
                {{ issueClass.name }}
              </span>
            </v-btn>
          </v-speed-dial>
          <v-speed-dial
            id="add-issue"
            key="add-issue"
            location="bottom left"
            transition="slide-y-transition"
          >
            <template #activator="{ props: activatorProps }">
              <v-fab
                v-bind="activatorProps"
                class="ma-0"
                color="secondary"
                elevation="12"
                icon="mdi-plus"
                size="x-large"
                variant="outlined"
              />
            </template>
            <v-btn
              v-for="issueClass in issueStore.issueClasses"
              :key="issueClass.id"
              class="issue-class-btn"
              color="secondary"
              elevation="12"
              size="large"
              variant="plain"
              @click="createIssue(issueClass)"
            >
              <span class="text-color">
                {{ issueClass.name }}
              </span>
            </v-btn>
          </v-speed-dial>
        </v-sheet>
        <v-sheet
          border="opacity-50 quinary thin"
          class="d-flex flex-column align-center justify-start elevation-0 pa-0 pt-10 mx-10 rounded-lg pa-1 overflow-y-auto issues-content"
        >
          <v-divider class="my-3" color="tertiary" />
          <v-expansion-panels v-model="expanded" class="mx-10 px-10 pt-0 elevation-0 multiple" static>
            <v-expansion-panel
              v-for="issue in issues"
              :id="`issue-${issue.id}`"
              :key="issue.id"
              class="mb-2 elevation-0 opacity-80 issues-panel"
              color="background"
              :value="issue.id"
            >
              <v-expansion-panel-title
                class="elevation-12 rounded-lg pa-2 ma-0 issue-title"
                @contextmenu.prevent="toggleSelectedIssue(issue.id)"
              >
                <v-sheet class="d-flex align-center justify-start elevation-0" color="background" variant="flat">
                  <v-checkbox
                    v-model="selectedIssueIds"
                    class="ml-2 mr-3 my-0 pa-0"
                    color="tertiary"
                    hide-details
                    :value="issue.id"
                    @click.stop
                  />
                  <span class="ma-0 mr-2 pa-0">
                    {{ issue.name }} |
                  </span>
                  <v-chip class="ml-2" color="tertiary" size="small" variant="flat">
                    {{ issue.issueClass?.name }}
                  </v-chip>
                </v-sheet>
              </v-expansion-panel-title>
              <v-expansion-panel-text class="border-0 elevation-0 pa-0 ma-0 mt-2 issue-text">
                <IssueCard
                  class="elevation-0"
                  :issue="issue"
                  :show-close="false"
                  @delete:issue="issueToDelete = issue; showConfirmDeleteDialog = true"
                  @navigate:element="navigateToElement"
                  @update:issue="refresh"
                />
              </v-expansion-panel-text>
            </v-expansion-panel>

          </v-expansion-panels>
        </v-sheet>
      </v-col>
    </v-row>
  </v-container>

  <v-snackbar v-model="snackBar.show" :color="snackBar.color" timeout="5000" top>
    {{ snackBar.message }}
  </v-snackbar>

  <ConfirmDeleteDialog
    :message="`Are you sure you want to delete this issue?`"
    :show="showConfirmDeleteDialog"
    @delete:canceled="showConfirmDeleteDialog = false"
    @delete:confirmed="deleteIssue"
  />
</template>

<style scoped>
.actions-container {
  padding-right: 90px;
}

.issues-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0; /* Important for flex child to shrink */
  overflow: hidden; /* Prevent content area from growing */
  background-color: rgba(var(--v-theme-foreground), 0);
  height: calc(100vh - 210px); /* Account for app bar and some padding */
}

.issues-panel {
  background-color: rgba(var(--v-theme-background), 0);
  border-width: 0;
}

.issues-panel * {
  box-shadow: none;
}

.issue-title {
  border-width: 1px;
  border-style: solid;
  border-color: rgba(var(--v-theme-quaternary), 1);
}

.issue-text {
  border-width: 0;
  background-color: rgba(var(--v-theme-background), 0.1);
}

.issue-link-class-btn {
  border-width: 1px;
  border-style: solid;
  border-color: rgba(var(--v-theme-tertiary), 1);
  background-color: rgba(var(--v-theme-tertiary), 1);
  .text-color {
    color: rgba(var(--v-theme-background), 1);
    font-weight: 600;
  }
}

.issue-class-btn {
  border-width: 1px;
  border-style: solid;
  border-color: rgba(var(--v-theme-secondary), 1);
  background-color: rgba(var(--v-theme-primary), 1);
  .text-color {
    color: rgba(var(--v-theme-tertiary), 1);
    font-weight: 600;
  }
}
</style>
