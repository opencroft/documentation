import assert from 'node:assert/strict'
import { test } from 'node:test'

import { JSDOM } from 'jsdom'

import { type Anchorer, type AnchorPosition, anchorComments, contentBeside } from './comment-anchors.ts'

// Two renderings of one document on a page, each with its own comments overlay
// beside its own `.prose-docs`, reduced to what anchoring reads.
function twoLayouts(text: string) {
  const dom = new JSDOM(
    `<!doctype html><body>
      <div class="hidden md:flex"><div class="relative"><div class="prose-docs"><p>${text}</p></div><div class="overlay"></div></div></div>
      <div class="md:hidden"><div class="relative"><div class="prose-docs"><p>${text}</p></div><div class="overlay"></div></div></div>
    </body>`,
  )
  const [desktop, mobile] = [...dom.window.document.querySelectorAll<HTMLElement>('.overlay')]
  return { dom, desktop, mobile }
}

/** Let observer callbacks (microtasks) and anything they schedule run out. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

const COMMENT = { id: 'c1', anchor: { quote: 'paragraph', prefix: '', suffix: '' } }

/**
 * Start one anchorer per overlay, the way the page does, and count how often
 * each reports positions. More than a handful of reports for one `update`
 * is the loop: the anchorers are stopped there so a regression fails this
 * test instead of hanging it.
 */
function startBoth(desktop: HTMLElement, mobile: HTMLElement) {
  const reports = { desktop: 0, mobile: 0 }
  const anchorers: Anchorer[] = []
  const counted = (which: 'desktop' | 'mobile') => (_positions: AnchorPosition[]) => {
    reports[which]++
    if (reports[which] > 20) {
      for (const a of anchorers) {
        a.stop()
      }
    }
  }
  const d = anchorComments(desktop, counted('desktop'))
  const m = anchorComments(mobile, counted('mobile'))
  assert.ok(d && m)
  anchorers.push(d, m)
  return { reports, anchorers: [d, m] as const }
}

test("each layout's overlay anchors its own document, once, and the two do not wake each other", async () => {
  const { desktop, mobile } = twoLayouts('A paragraph with a comment on it.')
  const { reports, anchorers } = startBoth(desktop, mobile)
  anchorers[0].update([COMMENT])
  anchorers[1].update([COMMENT])
  await settle()

  assert.deepEqual(reports, { desktop: 1, mobile: 1 })
  for (const overlay of [desktop, mobile]) {
    const anchors = contentBeside(overlay)?.querySelectorAll('.doc-comment-anchor') ?? []
    assert.equal(anchors.length, 1)
    assert.equal(anchors[0].textContent, 'paragraph')
  }
  for (const a of anchorers) {
    a.stop()
  }
})

test('a change to the document re-anchors it, once', async () => {
  const { desktop, mobile } = twoLayouts('A paragraph with a comment on it.')
  const { reports, anchorers } = startBoth(desktop, mobile)
  anchorers[0].update([COMMENT])
  anchorers[1].update([COMMENT])
  await settle()

  // What a highlight swap or a re-render does: the markup the anchor sat in
  // is replaced.
  const content = contentBeside(desktop)
  assert.ok(content)
  content.innerHTML = '<p>A paragraph with a comment on it, redrawn.</p>'
  await settle()

  assert.deepEqual(reports, { desktop: 2, mobile: 1 })
  assert.equal(content.querySelector('.doc-comment-anchor')?.textContent, 'paragraph')
  for (const a of anchorers) {
    a.stop()
  }
})

test("an overlay's document is the one beside it, not the page's first", () => {
  const { desktop, mobile } = twoLayouts('text')
  assert.notEqual(contentBeside(desktop), contentBeside(mobile))
  assert.equal(contentBeside(mobile)?.parentElement, mobile.parentElement)
})
