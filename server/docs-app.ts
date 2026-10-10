import type { AppInstanceContext, AppsExport } from '@opencroft/server/apps'
import { secrets } from '@opencroft/server/secrets'
import { execFile, fs } from '@opencroft/server/system'

import { docsAppActions } from './docs-app-actions'

// The Documentation App: each instance is one docs repository, cloned into
// the instance's private data directory (created by the host before onAdded,
// deleted by the host after onRemoved).

interface DocsAppParams {
  repoUrl?: string
  branch?: string
  /** `<storeId>/<key>` of the Secrets Store entry holding the git token (SecretSelector value). */
  tokenSecret?: string
  /** Git username for the token; hosts that ignore it work with the default. */
  username?: string
}

function isCloned(dir: string): Promise<boolean> {
  return fs
    .access(`${dir}/.git`)
    .then(() => true)
    .catch(() => false)
}

/** The clone URL with credentials resolved from the Secrets Store, when configured. */
async function resolveAuthUrl(params: DocsAppParams): Promise<string> {
  const repoUrl = params.repoUrl
  if (!repoUrl) {
    throw new Error('Repository URL is not set')
  }
  if (!params.tokenSecret) {
    return repoUrl
  }
  const slash = params.tokenSecret.indexOf('/')
  if (slash <= 0 || slash === params.tokenSecret.length - 1) {
    throw new Error(`Not a <storeId>/<key> secret address: ${params.tokenSecret}`)
  }
  const storeId = params.tokenSecret.slice(0, slash)
  const key = params.tokenSecret.slice(slash + 1)
  const token = await secrets.get(storeId, key)
  if (!token) {
    throw new Error(`Secret ${params.tokenSecret} not found or empty`)
  }
  const url = new URL(repoUrl)
  url.username = params.username || 'x-access-token'
  url.password = token
  return url.toString()
}

async function cloneInto(ctx: AppInstanceContext): Promise<void> {
  const params = ctx.params as DocsAppParams
  const authUrl = await resolveAuthUrl(params)
  const branch = params.branch || 'main'
  await execFile('git', [
    '-c',
    'safe.directory=*',
    'clone',
    '--branch',
    branch,
    '--single-branch',
    authUrl,
    ctx.dataDir,
  ])
  // Never leave the token on disk: the remote keeps the clean URL, and later
  // authenticated operations re-resolve credentials the same way this did.
  if (authUrl !== params.repoUrl) {
    await execFile('git', ['-C', ctx.dataDir, 'remote', 'set-url', 'origin', params.repoUrl as string])
  }
}

export const docsApps: AppsExport = {
  documentation: {
    async onAdded(ctx) {
      await cloneInto(ctx)
    },
    // Self-healing: an instance whose clone is missing (never finished, or
    // the data dir was lost) is cloned again on load.
    async onLoad(ctx) {
      if (!(await isCloned(ctx.dataDir))) {
        await cloneInto(ctx)
      }
      console.log(`[documentation] app instance loaded: ${ctx.instanceId} (${ctx.spaceSlug})`)
    },
    async onUnload(ctx) {
      console.log(`[documentation] app instance unloaded: ${ctx.instanceId}`)
    },
    async onRemoved(ctx) {
      console.log(`[documentation] app instance removed: ${ctx.instanceId}`)
    },
    actions: docsAppActions,
  },
}
