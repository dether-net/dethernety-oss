<script setup lang="ts">
  import { computed, nextTick, onMounted, ref, watch } from 'vue'
  import { useIssueStore } from '@/stores/issueStore'
  import { Class, Issue } from '@dethernety/dt-core'
  import { LocationQueryRaw, onBeforeRouteLeave, useRouter } from 'vue-router'
  import {
    applyLocalFiltering,
    buildRemoteFilterParams,
    type FetchIssuesParams,
    findUnrecognizedRemoteKeys,
    type ParsedSearch,
    parseSearchQuery,
    validateSearchQuery,
  } from '@/utils/issueSearchUtils'
  import { severityOf, SEVERITY_COLOR, type Severity } from '@/utils/issueSeverity'
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
  // Only what the user types into the search box — NOT filter state. The filter
  // menus are their own structured refs; the two are combined at read-time into
  // `effectiveQuery`. (Before S3b a single `search` ref held both, kept in sync by
  // a brittle string round-trip.)
  const manualQuery = ref('')
  const searchError = ref('')
  const isSearching = ref(false)
  const statusStrings = ['identified', 'analyzing', 'mitigating', 'monitored', 'resolved', 'accepted']
  const severityStrings = ['critical', 'high', 'medium', 'low']
  const likelihoodStrings = ['very-high', 'high', 'medium', 'low', 'very-low']
  const expanded = ref<string[]>([])
  const currentOpenPanelId = ref<string | null>(null)
  const showConfirmDeleteDialog = ref(false)
  const issueToDelete = ref<Issue | null>(null)
  const showConfirmMergeDialog = ref(false)
  const pendingMergeClass = ref<Class | null>(null)
  const isMerging = ref(false)
  const selectedIssueIds = ref<string[]>([])
  // The Issue Status remote filter — the open-on-load default lives here as the
  // ref's initial value (was previously seeded into the search string on mount).
  const issueStatusFilter = ref<string>('open')
  const showSearchHelp = ref(false)

  // Filter selections
  const selectedClass = ref<Class | null>(null)
  const selectedStatuses = ref<string[]>([])
  const selectedSeverities = ref<string[]>([])
  const selectedLikelihoods = ref<string[]>([])

  // Serialize the structured filter selections into the search mini-language.
  // Remote filters are bare key:value; local filters are one parenthesized group
  // per dimension (applyLocalFiltering ANDs across groups, ORs within one).
  const buildSearchFromFilters = (): string => {
    const parts: string[] = []

    // Remote filters (bare key:value)
    if (selectedClass.value) parts.push(`classId:"${selectedClass.value.id}"`)
    if (issueStatusFilter.value) parts.push(`issueStatus:"${issueStatusFilter.value}"`)

    // Local filters — one self-contained group per dimension (no outer nesting).
    const pushLocalGroup = (key: string, values: string[]) => {
      if (values.length === 0) return
      parts.push(`(${values.map(v => `${key}:"${v}"`).join(' OR ')})`)
    }
    pushLocalGroup('status', selectedStatuses.value)
    pushLocalGroup('severity', selectedSeverities.value)
    pushLocalGroup('likelihood', selectedLikelihoods.value)

    return parts.join(' ')
  }

  // The query that actually drives parse/fetch: the user's typed text plus the
  // structured filters. Filters are appended LAST so that for a duplicated remote
  // key, the structured filter wins (buildRemoteFilterParams is last-write-wins).
  const effectiveQuery = computed(() =>
    [manualQuery.value.trim(), buildSearchFromFilters()].filter(Boolean).join(' '))

  // Search functionality
  const parsedSearch = computed((): ParsedSearch => {
    if (!effectiveQuery.value.trim()) {
      return { remoteConditions: [], localGroups: [] }
    }
    return parseSearchQuery(effectiveQuery.value)
  })

  // True when any structured filter is active — drives the active-filter chip row
  // and the filter-remove icon's disabled state.
  const hasActiveFilters = computed(() =>
    !!selectedClass.value ||
    !!issueStatusFilter.value ||
    selectedStatuses.value.length > 0 ||
    selectedSeverities.value.length > 0 ||
    selectedLikelihoods.value.length > 0)

  // The single rendered list — derived from the store, not a local copy. Remote
  // conditions narrow the fetched set (issueStore.issues); local groups narrow the
  // render here. Reading the store directly is what makes optimistic CRUD render
  // without a refetch, and the store swaps its array only after a fetch resolves,
  // so the list never blanks mid-refetch (stale-while-revalidate).
  const displayedIssues = computed(() =>
    applyLocalFiltering(issueStore.issues, parsedSearch.value.localGroups))

  // A fetch is in flight (store-level or this page's search wrapper).
  const isListLoading = computed(() => issueStore.isLoading || isSearching.value)

  // Single discriminant driving the list region. `list` wins first so a background
  // refetch keeps the prior rows (stale-while-revalidate) instead of flashing
  // skeletons; only a genuinely empty list shows loading/error/empty.
  const listState = computed<'list' | 'loading' | 'error' | 'remote-empty' | 'local-empty'>(() => {
    if (displayedIssues.value.length > 0) return 'list'
    if (isListLoading.value) return 'loading'
    if (issueStore.error) return 'error'
    if (issueStore.issues.length === 0) return 'remote-empty'
    return 'local-empty' // rows were fetched but local filters hid them all
  })

  // Remote-empty copy adapts to the Issue Status filter so the default Open view
  // doesn't claim the whole dataset is empty when a closed backlog may exist.
  const remoteEmptyTitle = computed(() => {
    if (issueStatusFilter.value === 'open') return 'No open issues'
    if (issueStatusFilter.value === 'closed') return 'No closed issues'
    return 'No issues yet'
  })
  const remoteEmptySubtitle = computed(() => {
    if (issueStatusFilter.value === 'open') return 'Nothing needs triage right now. Create one with the + button.'
    if (issueStatusFilter.value === 'closed') return 'Nothing has been closed yet.'
    return 'Create your first issue with the + button.'
  })

  // Advisory, non-blocking hint for bare keys the server-side filter silently
  // drops (e.g. `severity:high` typed without parentheses). Debounced via
  // `debouncedQuery`, and suppressed while a syntax error already occupies the box.
  const debouncedQuery = ref('')
  const searchHint = computed(() => {
    if (searchError.value) return ''
    const unknown = findUnrecognizedRemoteKeys(debouncedQuery.value)
    if (unknown.length === 0) return ''
    const quoted = unknown.map(k => `"${k}"`).join(', ')
    const verb = unknown.length === 1 ? "isn't a server-side filter" : "aren't server-side filters"
    return `${quoted} ${verb} — wrap in ( ) to filter loaded issues, or use a known key: name, classId, issueStatus…`
  })

  const performSearch = async () => {
    searchError.value = ''

    // Validate the combined query (typed text + filters)
    const validation = validateSearchQuery(effectiveQuery.value)
    if (!validation.valid) {
      searchError.value = validation.error || 'Invalid search syntax'
      return
    }

    try {
      const parsed = parsedSearch.value

      // Perform remote filtering if there are remote conditions. The fetch updates
      // issueStore.issues, which drives the displayedIssues computed — no local copy.
      if (parsed.remoteConditions.length > 0) {
        const remoteParams = buildRemoteFilterParams(parsed.remoteConditions)
        await fetchIssues(remoteParams)
      } else {
        // Fetch all issues if no remote conditions
        await fetchIssues({})
      }

      // The refetch reset detailLoaded — re-hydrate any still-open panel so its
      // card doesn't silently revert to the summary shape.
      if (currentOpenPanelId.value) {
        await issueStore.fetchIssueDetail(currentOpenPanelId.value)
      }
    } catch (error) {
      // Syntax errors own the box (searchError); fetch failures route to the inline
      // error state via issueStore.error. Only toast when stale rows are still shown
      // (SWR) — otherwise the inline Retry block owns the empty case (no double-message).
      console.error('Search error:', error)
      if (displayedIssues.value.length > 0) {
        snackBar.value = {
          show: true,
          message: issueStore.error || 'Couldn’t refresh issues. Please try again.',
          color: 'error',
        }
      }
    }
  }

  // The search box's clear-X clears only the typed text — structured filters
  // persist (they have their own clear: the filter-remove icon / the chip row).
  // The manualQuery watcher issues the single refetch.
  const clearSearch = () => {
    manualQuery.value = ''
    searchError.value = ''
  }

  const clearAllFilters = () => {
    selectedClass.value = null
    issueStatusFilter.value = ''
    selectedStatuses.value = []
    selectedSeverities.value = []
    selectedLikelihoods.value = []
  }

  // Reset only the local (client-side) filters — leaves Class + Issue Status, since
  // the rows are present precisely because the remote fetch succeeded. Drives the
  // local-filtered-empty state's "Show all N issues" action (no refetch).
  const clearLocalFilters = () => {
    selectedStatuses.value = []
    selectedSeverities.value = []
    selectedLikelihoods.value = []
  }

  // Watchers
  watch(expanded, newVal => {
    if (!newVal || (Array.isArray(newVal) && newVal.length === 0)) {
      currentOpenPanelId.value = null
      return
    }

    nextTick(() => {
      const targetId = Array.isArray(newVal) ? newVal[newVal.length - 1] : newVal
      currentOpenPanelId.value = targetId

      // Fetch the heavy detail for the just-opened row (store guards re-fetch).
      issueStore.fetchIssueDetail(targetId)

      // Settle past the expand transition's first frame, then bring the row's title
      // to the top (block:'start') so the downward-growing card has room — without
      // yanking an already-visible row the way block:'center' did.
      requestAnimationFrame(() => {
        const panel = document.getElementById(`issue-${targetId}`)
        if (!panel) return
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
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

  const fetchIssues = async (remoteParams: FetchIssuesParams = {}) => {
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
    // Re-run the current query as-is — never re-snaps to the open default, so a
    // user who chose "All Issues" stays there.
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

  const createIssue = (issueClass: Class, name?: string, description?: string, comments?: string[], elementIds?: string[]): Promise<Issue | null> => {
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
    return issueStore.createIssue(issue).then(async result => {
      if (result) {
        // Guard length — addElementsToIssue rejects on an empty array, and an
        // empty `[]` is truthy (e.g. merging issues that carry no elements).
        if (elementIds && elementIds.length > 0) {
          await issueStore.addElementsToIssue({ issueId: result.id, elementIds })
        }
        // Settle the list first, then expand — so the new row's detail fetch
        // (triggered by the expand) isn't clobbered by the refetch reassign.
        await performSearch()
        expanded.value = [result.id]
      }
      return result ?? null
    })
  }

  // Merge is destructive (closes the originals) — gate it behind a confirm that
  // states the consequence, rather than firing straight from the FAB.
  const mergeConfirmMessage = computed(() => {
    const n = selectedIssueIds.value.length
    const cls = pendingMergeClass.value?.name ?? ''
    const leavesView = issueStatusFilter.value === 'open'
      ? ' — they will leave this view while the Open filter is active'
      : ''
    return `Close ${n} issues and create one merged ${cls} issue. The originals are closed, not deleted${leavesView}, and remain available under the Closed filter.`
  })

  const requestMerge = (issueClass: Class) => {
    if (selectedIssueIds.value.length < 2) return
    pendingMergeClass.value = issueClass
    showConfirmMergeDialog.value = true
  }

  const confirmMerge = async () => {
    if (isMerging.value) return
    showConfirmMergeDialog.value = false
    const issueClass = pendingMergeClass.value
    pendingMergeClass.value = null
    if (!issueClass) return
    // Let the dialog fully unmount (v-if) before the merge's heavy refetch
    // re-renders — otherwise the close races the dialog transition and sticks.
    await nextTick()
    isMerging.value = true
    try {
      await mergeIssues(issueClass)
    } finally {
      isMerging.value = false
    }
  }

  const mergeIssues = async (issueClass: Class) => {
    const selectedIds = [...selectedIssueIds.value]

    // Phase 1: ensure each selected issue's heavy detail (its `elements`) is
    // loaded — the list summary carries no relationship collections.
    await Promise.all(selectedIds.map(id => issueStore.fetchIssueDetail(id)))

    // Abort if any selected issue's detail didn't resolve — merging would
    // silently drop its (unknown) elements and still close the original.
    const unresolved = selectedIds.filter(id => !issueStore.detailLoaded.has(id))
    if (unresolved.length > 0) {
      snackBar.value = {
        show: true,
        message: 'Could not load all selected issues — merge cancelled. Please retry.',
        color: 'error',
      }
      return
    }

    // Phase 2: snapshot elements + comments BEFORE any status write. The
    // UPDATE_ISSUE response omits some collections, so writing status first would
    // shrink `elements` and the merged issue would lose them.
    const comments: string[] = []
    const elementIds: string[] = []
    const issuesToClose: Issue[] = []
    for (const issueId of selectedIds) {
      const issue = issueStore.getIssueById(issueId)
      if (issue) {
        if (issue.elements && Array.isArray(issue.elements)) {
          elementIds.push(...issue.elements.map((element: any) => element.id))
        }
        // Only carry a "Comments from X" header when X actually has comments —
        // otherwise the merged description gets an empty header per source issue.
        if (issue.comments && Array.isArray(issue.comments) && issue.comments.length > 0) {
          comments.push(`Comments from ${issue.name}`)
          comments.push(...issue.comments)
        }
        issuesToClose.push(issue)
      }
    }

    // Phase 3: close the originals — sequentially awaited + counted, so a partial
    // failure is surfaced rather than silently leaving originals open. (Closing them
    // concurrently raced the store's optimistic updates and dropped one.)
    let failed = 0
    for (const issue of issuesToClose) {
      try {
        await issueStore.updateIssue({ ...issue, issueStatus: 'closed' })
      } catch {
        failed++
      }
    }

    // Phase 4: create the merged issue carrying the originals' elements/comments.
    // createIssue rejects on a store failure (and addElementsToIssue can reject
    // after the issue already exists), so catch here — otherwise a throw escapes
    // with the originals already closed and no feedback shown.
    let merged: Issue | null = null
    try {
      merged = await createIssue(
        issueClass,
        `New ${issueClass.name} Issue from ${issuesToClose.length} issues`,
        `Merged issues: \n- ${issuesToClose.map(issue => issue.name).join('\n - ')}`,
        comments,
        elementIds,
      )
    } catch (err) {
      console.error('Error creating merged issue:', err)
    }
    selectedIssueIds.value = []

    // Report the outcome honestly — name the result, and don't pretend atomicity.
    if (!merged) {
      const closed = issuesToClose.length - failed
      snackBar.value = {
        show: true,
        message: closed > 0
          ? `Couldn’t create the merged issue, but ${closed} of ${issuesToClose.length} selected issue(s) were already closed — review them manually.`
          : 'Couldn’t create the merged issue — please retry.',
        color: 'error',
      }
    } else if (failed > 0) {
      snackBar.value = {
        show: true,
        message: `Created "${merged.name}", but ${failed} of ${issuesToClose.length} original issues couldn't be closed — review them manually.`,
        color: 'warning',
      }
    } else {
      snackBar.value = {
        show: true,
        message: `Merged ${issuesToClose.length} issues into "${merged.name}".`,
        color: 'success',
      }
    }
  }

  const navigateToElement = (path: string, query: LocationQueryRaw) => {
    router.push({ path, query })
  }

  // The Issue Status radio binds `issueStatusFilter` directly (the remote-filter
  // watcher refetches). Drives the activator button colour.
  const hasIssueStatusFilter = computed(() => issueStatusFilter.value !== '')

  // The Class radio binds by id (selectedClass is the Class object).
  const onSelectClass = (id: string | null) => {
    selectedClass.value = id ? (issueStore.issueClasses.find(c => c.id === id) ?? null) : null
  }

  // Typed text refetches on a debounce (per-keystroke). Empty manual text just
  // means "query = filters only" — still a valid refetch, no special-casing.
  let searchTimeout: ReturnType<typeof setTimeout> | undefined
  watch(manualQuery, () => {
    if (searchTimeout) {
      clearTimeout(searchTimeout)
    }
    searchTimeout = setTimeout(() => {
      debouncedQuery.value = manualQuery.value
      performSearch()
    }, 500)
  })

  // Remote filters (Class, Issue Status) refetch on change — discrete clicks, no
  // debounce. Local filters (status/severity/likelihood) are deliberately NOT
  // watched: they flow through effectiveQuery → parsedSearch → displayedIssues and
  // narrow the already-fetched list client-side, with zero network round-trip.
  watch([selectedClass, issueStatusFilter], () => {
    performSearch()
  })

  onMounted(() => {
    fetchIssueClasses()
    // issueStatusFilter defaults to 'open', so effectiveQuery is issueStatus:"open"
    // here — this explicit call is the single mount fetch (no watcher fires on
    // initial ref values).
    performSearch()
    if (issueStore.getIssueDataClipboard()) {
      snackBar.value.show = true
      snackBar.value.message = 'Select an issue to add the data'
      snackBar.value.color = 'success'
    }
  })

  onBeforeRouteLeave(() => {
    issueStore.resetIssue()
  })
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
                  <v-radio-group
                    class="ma-0 px-4 py-2"
                    color="tertiary"
                    hide-details
                    :model-value="selectedClass?.id ?? null"
                    @update:model-value="onSelectClass"
                  >
                    <v-radio class="text-color" label="All Classes" :value="null" />
                    <v-radio
                      v-for="issueClass in issueStore.issueClasses"
                      :key="issueClass.id"
                      class="text-color"
                      :label="issueClass.name"
                      :value="issueClass.id"
                    />
                  </v-radio-group>
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
                  <v-radio-group
                    v-model="issueStatusFilter"
                    class="ma-0 px-4 py-2"
                    color="tertiary"
                    hide-details
                  >
                    <v-radio class="text-color" label="All Issues" :value="''" />
                    <v-radio class="text-color" label="Open Issues" value="open" />
                    <v-radio class="text-color" label="Closed Issues" value="closed" />
                  </v-radio-group>
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
                :disabled="!hasActiveFilters"
                icon
                size="small"
                variant="text"
                @click="clearAllFilters"
              >
                <v-icon icon="mdi-filter-remove" />
                <v-tooltip activator="parent" location="bottom" text="Clear filters" />
              </v-btn>
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
                icon
                size="small"
                variant="text"
                @click="showSearchHelp = !showSearchHelp"
              >
                <v-icon icon="mdi-help" />
                <v-tooltip activator="parent" location="bottom" text="Search help" />
              </v-btn>
            </v-sheet>
          </v-card-title>
          <v-card-text class="py-0 pt-2">
            <div class="d-flex align-center justify-start flex-column w-100 px-5">
              <v-text-field
                v-model="manualQuery"
                class="ma-0 pa-0 w-100"
                clearable
                :error="!!searchError"
                :error-messages="searchError"
                label="Search (e.g., name:'Threat Vector' (id:123 OR type:security))"
                :loading="isSearching"
                prepend-inner-icon="mdi-magnify"
                @click:clear="clearSearch"
              />

              <!-- Active-filter chips — the always-visible, individually-removable
                   view of the structured filters (the box itself only shows typed
                   text). Remote-filter chips refetch on removal; local ones recompute. -->
              <div
                v-if="hasActiveFilters"
                class="d-flex align-center flex-wrap justify-start w-100 mb-2"
                style="gap: 4px;"
              >
                <v-chip
                  v-if="issueStatusFilter"
                  closable
                  color="tertiary"
                  size="small"
                  variant="tonal"
                  @click:close="issueStatusFilter = ''"
                >
                  {{ issueStatusFilter === 'open' ? 'Open' : 'Closed' }}
                </v-chip>
                <v-chip
                  v-if="selectedClass"
                  closable
                  color="tertiary"
                  size="small"
                  variant="tonal"
                  @click:close="selectedClass = null"
                >
                  Class: {{ selectedClass.name }}
                </v-chip>
                <v-chip
                  v-for="status in selectedStatuses"
                  :key="`chip-status-${status}`"
                  class="text-capitalize"
                  closable
                  color="tertiary"
                  size="small"
                  variant="tonal"
                  @click:close="selectedStatuses = selectedStatuses.filter(s => s !== status)"
                >
                  Status: {{ status }}
                </v-chip>
                <v-chip
                  v-for="severity in selectedSeverities"
                  :key="`chip-severity-${severity}`"
                  class="text-capitalize"
                  closable
                  :color="SEVERITY_COLOR[severity as Severity] ?? 'tertiary'"
                  size="small"
                  variant="tonal"
                  @click:close="selectedSeverities = selectedSeverities.filter(s => s !== severity)"
                >
                  Severity: {{ severity }}
                </v-chip>
                <v-chip
                  v-for="likelihood in selectedLikelihoods"
                  :key="`chip-likelihood-${likelihood}`"
                  class="text-capitalize"
                  closable
                  color="tertiary"
                  size="small"
                  variant="tonal"
                  @click:close="selectedLikelihoods = selectedLikelihoods.filter(l => l !== likelihood)"
                >
                  Likelihood: {{ likelihood }}
                </v-chip>
              </div>

              <!-- Advisory, non-blocking: bare keys the server-side filter silently
                   drops (e.g. `severity:high` without parentheses). Never blocks search. -->
              <div v-if="searchHint" class="d-flex align-center w-100 text-caption text-medium-emphasis mb-2">
                <v-icon class="mr-1" icon="mdi-information-outline" size="x-small" />
                <span>{{ searchHint }}</span>
              </div>

              <v-expand-transition>
                <v-card
                  v-if="showSearchHelp"
                  class="mt-2 mb-5 w-100"
                  variant="tonal"
                >
                  <v-card-text class="pa-3 text-body-2">
                    <v-row dense>
                      <v-col cols="12" sm="6">
                        <div class="font-weight-bold mb-1">Server-side · <code>key:value</code></div>
                        <div class="text-medium-emphasis mb-1">Narrows what's fetched. No operators.</div>
                        <div>name, issueId, classId, elementIds, classType, moduleId, moduleName, issueStatus</div>
                      </v-col>
                      <v-col cols="12" sm="6">
                        <div class="font-weight-bold mb-1">Loaded issues · <code>(key:value AND/OR …)</code></div>
                        <div class="text-medium-emphasis mb-1">Narrows the loaded list. Wrap in ( ).</div>
                        <div>id, name, description, type, category, open, class.name, class.type</div>
                        <div class="text-medium-emphasis mt-1">+ any custom attribute (e.g. severity, likelihood) — searched in synced attributes.</div>
                      </v-col>
                    </v-row>
                    <v-divider class="my-2" />
                    <div class="font-weight-bold mb-1">Examples</div>
                    <div><code>issueStatus:open</code> · <code>name:'Security Issue'</code></div>
                    <div><code>(severity:high OR severity:critical)</code></div>
                    <div><code>classType:vulnerability (name:SQL OR description:injection)</code></div>
                    <div class="text-medium-emphasis mt-1">The filter buttons above add these for you. Open issues are shown by default.</div>
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
              <!-- Span owns the tooltip so it still shows while the FAB is disabled
                   (a disabled Vuetify button swallows hover). -->
              <span style="display: inline-block;">
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
                <v-tooltip
                  activator="parent"
                  location="bottom"
                  :text="selectedIssueIds.length < 2 ? 'Select 2 or more issues to merge' : 'Merge selected issues'"
                />
              </span>
            </template>
            <v-btn
              v-for="issueClass in issueStore.issueClasses"
              :key="issueClass.id"
              class="issue-link-class-btn"
              color="tertiary"
              elevation="12"
              size="large"
              variant="plain"
              @click="requestMerge(issueClass)"
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
              <span style="display: inline-block;">
                <v-fab
                  v-bind="activatorProps"
                  class="ma-0"
                  color="secondary"
                  elevation="12"
                  icon="mdi-plus"
                  size="x-large"
                  variant="outlined"
                />
                <v-tooltip
                  activator="parent"
                  location="bottom"
                  text="New issue"
                />
              </span>
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

          <!-- Loading: skeletons on cold load only. A refetch keeps the prior rows
               (stale-while-revalidate), so this never flashes mid-refresh. -->
          <div v-if="listState === 'loading'" class="w-100 px-10">
            <v-skeleton-loader
              v-for="i in 5"
              :key="`issue-sk-${i}`"
              class="mb-2"
              type="list-item-two-line"
            />
          </div>

          <!-- Error: surface the store's specific message inline with a Retry. -->
          <div
            v-else-if="listState === 'error'"
            class="d-flex flex-column align-center justify-center text-center text-medium-emphasis py-10 px-4"
          >
            <v-icon class="mb-3" color="error" icon="mdi-alert-circle-outline" size="48" />
            <div class="text-body-1 mb-1">{{ issueStore.error }}</div>
            <v-btn class="mt-3" color="tertiary" variant="tonal" @click="performSearch">Retry</v-btn>
          </div>

          <!-- Remote-empty: the server-side filter returned nothing (status-aware copy). -->
          <div
            v-else-if="listState === 'remote-empty'"
            class="d-flex flex-column align-center justify-center text-center text-medium-emphasis py-10 px-4"
          >
            <v-icon class="mb-3" color="secondary" icon="mdi-inbox-outline" size="48" />
            <div class="text-body-1 mb-1">{{ remoteEmptyTitle }}</div>
            <div class="text-caption text-disabled">{{ remoteEmptySubtitle }}</div>
          </div>

          <!-- Local-empty: rows were fetched but the local filters hid them all. -->
          <div
            v-else-if="listState === 'local-empty'"
            class="d-flex flex-column align-center justify-center text-center text-medium-emphasis py-10 px-4"
          >
            <v-icon class="mb-3" color="secondary" icon="mdi-filter-variant-remove" size="48" />
            <div class="text-body-1 mb-1">No issues match your filters.</div>
            <v-btn class="mt-3" color="tertiary" variant="tonal" @click="clearLocalFilters">
              Show all {{ issueStore.issues.length }} issues
            </v-btn>
          </div>

          <v-expansion-panels v-else v-model="expanded" class="mx-10 px-10 pt-0 elevation-0 multiple" static>
            <v-expansion-panel
              v-for="issue in displayedIssues"
              :id="`issue-${issue.id}`"
              :key="issue.id"
              class="mb-2 elevation-0 opacity-80 issues-panel"
              color="background"
              :value="issue.id"
            >
              <v-expansion-panel-title
                class="elevation-12 rounded-lg pa-2 ma-0 issue-title"
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
                  <span class="ma-0 mr-2 pa-0 text-truncate" style="min-width: 0" :title="issue.name">
                    {{ issue.name }} |
                  </span>
                  <v-chip
                    v-if="severityOf(issue)"
                    class="ml-2 text-capitalize flex-shrink-0"
                    :color="SEVERITY_COLOR[severityOf(issue)!]"
                    size="small"
                    variant="flat"
                  >
                    {{ severityOf(issue) }}
                  </v-chip>
                  <v-chip class="ml-2 flex-shrink-0" color="tertiary" size="small" variant="tonal">
                    {{ issue.issueClass?.name }}
                  </v-chip>
                </v-sheet>
              </v-expansion-panel-title>
              <v-expansion-panel-text class="border-0 elevation-0 pa-0 ma-0 mt-2 issue-text">
                <IssueCard
                  v-if="expanded.includes(issue.id) && issueStore.detailLoaded.has(issue.id)"
                  :key="issue.id"
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

  <ConfirmDeleteDialog
    v-if="showConfirmMergeDialog"
    confirm-color="tertiary"
    confirm-icon="mdi-link-variant"
    confirm-label="Merge & close"
    icon="mdi-link-variant"
    :message="mergeConfirmMessage"
    :show="showConfirmMergeDialog"
    title="Merge issues"
    @delete:canceled="showConfirmMergeDialog = false; pendingMergeClass = null"
    @delete:confirmed="confirmMerge"
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
