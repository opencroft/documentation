# Documentation

Provides the **Documentation App**: add it to a space with a git repository of markdown pages, then browse, search and edit them, with the space's chat beside the page. Pages are edited as a shared draft that everyone editing the page sees live, and published back to the repository as a commit.

## App parameters

- `repoUrl` — the repository to clone.
- `branch` — the branch to read and publish to; `main` when empty.
- `tokenSecret` — optional, the Secrets Store key holding an access token, as `<storeId>/<key>`.
- `username` — optional git username for the token.

## App actions (agent-invokable)

Discover with `app_list` and run with `app_call`:

- `search` — search the published pages.
- `read` — read a page, published (default) or its current draft.
- `edit`, `write` — change a page's draft.
- `publish` — commit and push one page. A page starts with its title (`# Title`) and is saved in the file named after it.
- `move` — move a page or folder, or reorder it in its folder.
- `setFolderTitle` — give a folder a title and rename it after the title.
- `pull` — bring the clone up to date, keeping drafts.

## The tree

Each folder may hold a `_meta.json` with its title and the order of its entries: `{ "title": "Guides", "order": ["intro.md", "setup"] }`. Entries it does not list follow the listed ones, folders first, then pages, by name. It names only what is committed: a page that is not published yet follows the listed entries, can move to another folder but not be placed within one, and is added to the order when it is published. A move, a folder rename and a publish under a new title are each one commit, pushed at once, with relative links to and from what moved rewritten in published pages and drafts. Links the rewrite can't fix and mentions of the old path in text are reported, not edited; references from outside the repository (other documentation apps, tasks, chats) are not followed.

## Tests

```bash
npm install
npm test
```
