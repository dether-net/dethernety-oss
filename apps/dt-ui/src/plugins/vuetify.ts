/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import colors from 'vuetify/util/colors'
import { md2 } from 'vuetify/blueprints'

// Composables
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// Labs components
import { VTimePicker } from 'vuetify/components/VTimePicker'
import { VNumberInput } from 'vuetify/components/VNumberInput'
// import { VTreeview } from 'vuetify/labs/VTreeview'

// import colors from 'vuetify/util/colors'

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  components: {
    ...components,
    ...directives,
    VTimePicker,
    VNumberInput,
    // VTreeview,
  },
  defaults: {
    global: {
      density: 'compact',
    },
    VTextField: {
      density: 'compact',
      dense: true,
    },
    VSelect: {
      density: 'compact',
      dense: true,
    },
    VRow: {
      class: 'py-0',
    },
    VField: {
      density: 'compact',
    },
    VAutoComplete: {
      density: 'compact',
    },
    VToolbar: {
      density: 'compact',
      dense: true,
      VToolbarTitle: {
        class: 'py-0 text-body-1',
      },
    },
    VWindow: {
      VCard: {
        VContainer: {
          class: 'pa-1',
          VField: {
            class: 'pa-2',
            density: 'compact',
          },
        },
      },
    },
  },
  blueprint: md2,
  icons: {
    defaultSet: 'mdi',
  },
  theme: {
    defaultTheme: 'dark',
    themes: {
      light: {
        dark: false,
        colors: {
          background: colors.grey.lighten2,
          // background: colors.blueGrey.darken4,
          // surface: '#39603d',
          surface: colors.blueGrey.darken2,
          // surface: colors.grey.darken4,
          // 'surface-light': '#34495E',
          // 'surface-light': colors.blueGrey.darken2,
          primary: '#3c403d',
          secondary: '#3c403d',
          // accent: colors.blueGrey.darken1,
          // error: colors.red.accent3,
          // 'nodecolor-1': '#a4c2f4',
          // 'nodecolor-2': '#5b8ad8',
          // 'nodecolor-3': '#3d6cb9',
          // 'nodecolor-selected-1': '#81a4e3',
          // 'nodecolor-selected-2': '#4a75c4',
          // 'nodecolor-selected-3': '#2c5aa5',
          'nodecolor-1': colors.blueGrey.lighten3,
          'nodecolor-2': colors.blueGrey.lighten2,
          'nodecolor-3': colors.blueGrey.lighten1,
          'nodecolor-selected-1': colors.blueGrey.darken1,
          'nodecolor-selected-2': colors.blueGrey.darken2,
          'nodecolor-selected-3': colors.blueGrey.darken3,
        },
      },
      dark: {
        dark: true,
        colors: {
          background: '#2d3748',
          // background: colors.blueGrey.darken4,
          // surface: '#2C3E50',
          surface: colors.grey.darken4,
          // 'surface-light': '#34495E',
          // 'surface-light': colors.blueGrey.darken2,
          // primary: colors.cyan.darken4,
          // secondary: colors.cyan.darken1,
          primary: '#264653',
          secondary: '#2a9d8f',
          tertiary: '#e9c46a',
          quaternary: '#f4a261',
          quinary: '#e76f51',
          // accent: colors.blueGrey.darken1,
          // error: colors.red.accent3,
          'nodecolor-1': '#70819e',
          'nodecolor-2': '#4a5568',
          'nodecolor-3': '#3a4455',
          'nodecolor-selected-1': '#505c6f',
          'nodecolor-selected-2': '#3a4455',
          'nodecolor-selected-3': '#2a3441',
        },
      },
    },
  },
})
