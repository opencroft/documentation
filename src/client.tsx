import { legacy } from '@opencroft/client'

import { DocsAppForm } from './app-form'
import { DocsAppView } from './app-view'

const { defineExtension } = legacy

export default defineExtension({
  manifest: {},
  provides: {
    apps: [
      {
        type: 'documentation',
        title: 'Documentation',
        description: 'Browse and edit a documentation repository.',
        icon: 'BookOpen',
        component: DocsAppView,
        form: DocsAppForm,
      },
    ],
  },
})
