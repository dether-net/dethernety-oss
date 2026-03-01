<script setup lang="ts">
  import { useFolderStore } from '@/stores/folderStore'
  import type { Folder } from '@dethernety/dt-core'

  interface Props {
    show: boolean
    currentFolderId?: string
  }

  interface TreeItem {
    id: string
    title: string
    children?: TreeItem[]
    folder: Folder
  }

  const props = defineProps<Props>()
  const showDialog = ref(props.show)
  const folderStore = useFolderStore()
  const emit = defineEmits<{(e: 'close'): void, (e: 'error', error: any): void, (e: 'move', folderId: string): void}>()

  const cancelDialog = () => {
    emit('close')
  }

  const moveToFolder = (folderId: string) => {
    emit('move', folderId)
  }

  const buildFolderTree = (folders: Folder[], excludeFolderId?: string): TreeItem[] => {
    const folderMap = new Map<string, TreeItem>()
    const rootItems: TreeItem[] = []

    const filteredFolders = folders.filter(folder => {
      if (folder.id === excludeFolderId) return false
      if (excludeFolderId && isDescendantOf(folder, excludeFolderId, folders)) return false
      return true
    })

    filteredFolders.forEach(folder => {
      if (folder.id) {
        folderMap.set(folder.id, {
          id: folder.id,
          title: folder.name as string,
          children: [],
          folder,
        })
      }
    })

    filteredFolders.forEach(folder => {
      if (folder.id) {
        const treeItem = folderMap.get(folder.id)
        if (treeItem) {
          if (folder.parentFolder?.id) {
            const parent = folderMap.get(folder.parentFolder.id)
            if (parent) {
              parent.children = parent.children || []
              parent.children.push(treeItem)
            }
          } else {
            rootItems.push(treeItem)
          }
        }
      }
    })

    return rootItems
  }

  const isDescendantOf = (folder: Folder, ancestorId: string, allFolders: Folder[]): boolean => {
    let current = folder
    while (current.parentFolder?.id) {
      if (current.parentFolder.id === ancestorId) return true
      current = allFolders.find(f => f.id === current.parentFolder?.id) || current
      if (!current.parentFolder) break
    }
    return false
  }

  const treeData = computed(() => buildFolderTree(folderStore.folders, props.currentFolderId))

  watch(() => props.show, newVal => {
    showDialog.value = newVal
  })

  onMounted(async () => {
    if (folderStore.folders.length === 0) {
      await folderStore.fetchFolders()
    }
  })
</script>

<template>
  <v-dialog
    v-model="showDialog"
    max-width="700"
    @keydown.esc="cancelDialog"
    @update:model-value="$emit('close')"
  >
    <v-card class="pa-0 ma-0 rounded-lg">
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="foreground" size="small">mdi-folder-move</v-icon>
            <span class="ml-2 text-body-1">Select Destination Folder</span>
          </div>
          <v-btn
            color="foreground"
            icon="mdi-close"
            size="medium"
            variant="text"
            @click="cancelDialog"
          />
        </v-sheet>
      </v-card-title>

      <v-card-text class="pa-0 px-5 pt-5 ma-2">
        <div class="mb-4">
          <v-btn
            color="secondary"
            prepend-icon="mdi-home"
            variant="plain"
            @click="moveToFolder('root')"
          >
            Move to Root
          </v-btn>
        </div>

        <v-divider class="mb-4" />

        <div v-if="treeData.length > 0" class="folder-tree">
          <v-treeview
            density="compact"
            item-children="children"
            item-key="id"
            item-title="title"
            :items="treeData"
            open-strategy="multiple"
          >
            <template #prepend>
              <v-icon color="secondary">mdi-folder-outline</v-icon>
            </template>

            <template #append="{ item }">
              <v-icon
                color="secondary"
                size="small"
                variant="plain"
                @click="moveToFolder(item.id)"
              >
                mdi-arrow-right-bold-circle-outline
              </v-icon>
              <v-btn
                color="secondary"
                size="small"
                variant="plain"
                @click="moveToFolder(item.id)"
              >
                Move Here
              </v-btn>
            </template>
          </v-treeview>
        </div>

        <div v-else class="text-center py-4">
          <v-icon color="grey" size="48">mdi-folder-outline</v-icon>
          <p class="text-grey mt-2">No folders available</p>
        </div>
      </v-card-text>

    </v-card>
  </v-dialog>
</template>

<style scoped>
.folder-tree {
  height: 300px;
  overflow-y: auto;
}

.headline {
  font-family: 'JetBrains Mono', monospace !important;
}
</style>
