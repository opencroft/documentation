import { defineExtension } from '@opencroft/client/extension'

import { DocsAppForm } from './app-form'
import { DocsAppView } from './app-view'

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
