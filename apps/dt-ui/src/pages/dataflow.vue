<script setup lang="ts">

</script>

<template>
  <v-container class="pa-0 fill-height" fluid>
    <v-row class="fill-height" no-gutters>
      <v-col class="d-flex flex-column fill-height" style="height: 100%;">
        <div class="flex-grow-1 d-flex">
          <DataFlow class="flex-grow-1" />
        </div>
      </v-col>
    </v-row>
  </v-container>
</template>

<style>
  @import '@/components/DataFlow/Style/main.css';
</style>

<style scoped>
  .v-container {
    height: 100vh;
  }
  .v-col {
  display: flex;
  flex-direction: column;
  height: 100vh;
  }
  .v-container.pa-0 {
    flex: 1 1 auto;
  }
  .fill-height {
  height: 100%;
  }
  .flex-grow-1 {
    flex-grow: 1;
  }
</style>
