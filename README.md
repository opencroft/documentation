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
- `publish` — commit and push one page.
- `pull` — bring the clone up to date, keeping drafts.

## Tests

```bash
npm install
npm test
```
