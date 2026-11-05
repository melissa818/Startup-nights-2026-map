# Backend (Langrove project `startup-nights-2026`)

The backend lives in the Langrove project **startup-nights-2026** and is edited there (console or MCP
connector). This folder is a reference copy so the code is reviewable in git.

| Environment | URL |
|---|---|
| dev | https://startup-nights-2026--dev.ttm.devcore.build |
| staging | https://startup-nights-2026--staging.ttm.devcore.build |
| production | https://startup-nights-2026.ttm.devcore.build |

Changes are live on **dev** as soon as they are saved. Staging and production only change when a
project member deploys from the Langrove console.

## Data models

**Visitor**: one row per person who signs in to sync.

| field | type | notes |
|---|---|---|
| id | uuid | |
| email | string | unique index; the login field of the `code` door |

**BoothMark**: one row per visitor and startup.

| field | type | notes |
|---|---|---|
| id | uuid | |
| visitor | relation → Visitor | |
| startup | string | startup id slug from `site/data/startups.json` |
| visited | boolean | |
| interested | boolean | the "starred" flag in the UI |
| note | text | up to 4000 characters |
| changed_at | number | epoch ms of the edit on the visitor's device; newest edit wins |

Unique index on `(visitor, startup)`, used by `upsertMany`.

## Sign-in

Access **`code`**, kind `one-time`: a 6-digit code mailed by the platform, valid 10 minutes,
signing people in as `Visitor` by `email`. The app calls:

1. `POST /visitors { email }`: creates the Visitor row if missing (the code door only mails known rows)
2. `POST /_auth/code/begin { email }`: sends the code
3. `POST /_auth/code/verify { email, code }`: sets the session cookie

## Policies (default deny)

| policy | rule |
|---|---|
| `boothmark.read` / `create` / `update` / `delete` | allow when `resource.visitor` is the signed-in Visitor |
| `visitor.read` | allow when the resource is the signed-in Visitor |

So a visitor can only ever read or write their own marks; anonymous callers get nothing.

## Endpoints

| method | path | callers | code |
|---|---|---|---|
| POST | `/visitors` | anyone | [register_visitor.js](endpoints/register_visitor.js) |
| GET | `/visitors/me` | Visitor | [get_me.js](endpoints/get_me.js) |
| GET | `/marks` | Visitor | [list_marks.js](endpoints/list_marks.js) |
| PUT | `/marks` | Visitor | [save_marks.js](endpoints/save_marks.js) |
| DELETE | `/sessions/current` | Visitor | [end_session.js](endpoints/end_session.js) |

`PUT /marks` takes `{ marks: { "<startup-id>": { visited, interested, note, changed_at } } }`, keeps
whichever edit is newer per startup, and answers the visitor's full list.

## Tested (test data world)

- Register: valid email is normalised and stored; invalid email answers 400.
- Two visitors marking the same startup each see only their own row.
- A stale edit (`changed_at` older than the stored one) does not overwrite; a newer one does.
- `GET /marks` without a session answers 401.
- An invalid startup id answers 400.
