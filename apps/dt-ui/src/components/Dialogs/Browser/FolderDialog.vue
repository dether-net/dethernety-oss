<script setup lang="ts">
  import { useFolderStore } from '@/stores/folderStore'
  import { Folder } from '@dethernety/dt-core'

  interface Props {
    show: boolean
    type: 'create' | 'edit'
    folder?: Folder
  }

  const props = defineProps<Props>()
  const folderStore = useFolderStore()

  const folder = ref<Folder>({
    id: props.type === 'edit' ? props.folder?.id : undefined,
    name: props.type === 'edit' ? props.folder?.name || '' : '',
    description: props.type === 'edit' ? props.folder?.description || '' : '',
    parentFolder: props.type === 'edit' ? props.folder?.parentFolder || undefined : undefined,
  })

  const emit = defineEmits<{(e: 'close'): void, (e: 'error', error: any): void}>()
  const cancelDialog = () => {
    emit('close')
  }

  const saveFolder = async () => {
    try {
      if (!folder.value.name) {
        return
      }
      if (props.type === 'create') {
        if (folderStore.selectedFolder) {
          folder.value.parentFolder = folderStore.selectedFolder
        }
        await folderStore.createFolder(folder.value)
      } else {
        await folderStore.updateFolder(folder.value)
      }
      emit('close')
    } catch (error) {
      console.error('Error saving folder:', error)
      emit('error', error)
    }
  }

</script>

<template>
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <v-dialog
    max-width="500"
    :model-value="show"
    @keydown.esc="cancelDialog"
    @update:model-value="$emit('close')"
  >
    <v-card class="pa-0 ma-0 rounded-lg">
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="foreground" size="small">mdi-folder-outline</v-icon>
            <span class="ml-2 text-body-1">{{ type === 'create' ? 'Create Folder' : 'Edit Folder' }}</span>
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
        <v-row>
          <v-col cols="12">
            <v-text-field v-model="folder.name" label="Folder Name" />
          </v-col>
          <v-col cols="12">
            <v-textarea v-model="folder.description" label="Folder Description" />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions class="py-2 mx-5 mb-3">
        <v-btn
          color="primary"
          icon="mdi-check"
          size="x-large"
          variant="outlined"
          @click="saveFolder"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
