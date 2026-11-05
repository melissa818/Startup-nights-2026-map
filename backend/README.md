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

**Visitor**: one row per person who signs in.

| field | type | notes |
|---|---|---|
| id | uuid | |
| email | string | unique index; the login field of the `code` door |
| own_startup | string | startup id of the booth this person staffs, if any |
| welcomed | boolean | set after the first-login welcome has been shown |

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

**BoothNote**: an exhibitor's private notes about people who visited their booth.

| field | type | notes |
|---|---|---|
| id | uuid | |
| owner | relation → Visitor | the author; only they can read it |
| client_id | string | id made on the device, so notes can be written offline; unique with owner |
| startup | string | the booth the note belongs to |
| person / contact | string | visitor name; company, email or phone |
| note | text | feedback, up to 4000 characters |
| created_at / changed_at | number | epoch ms; newest edit wins |
| deleted | boolean | tombstone, so a delete reaches the author's other devices |

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
| `boothnote.read` / `create` / `update` / `delete` | allow when `resource.owner` is the signed-in Visitor |
| `visitor.read` / `visitor.update` | allow when the resource is the signed-in Visitor |

So a person can only ever read or write their own marks and booth notes; anonymous callers get nothing.

## Endpoints

| method | path | callers | code |
|---|---|---|---|
| POST | `/visitors` | anyone | [register_visitor.js](endpoints/register_visitor.js) |
| GET | `/visitors/me` | Visitor | [get_me.js](endpoints/get_me.js) |
| PATCH | `/visitors/me` | Visitor | [update_me.js](endpoints/update_me.js) |
| GET | `/marks` | Visitor | [list_marks.js](endpoints/list_marks.js) |
| PUT | `/marks` | Visitor | [save_marks.js](endpoints/save_marks.js) |
| GET | `/booth-notes` | Visitor | [list_booth_notes.js](endpoints/list_booth_notes.js) |
| PUT | `/booth-notes` | Visitor | [save_booth_notes.js](endpoints/save_booth_notes.js) |
| DELETE | `/sessions/current` | Visitor | [end_session.js](endpoints/end_session.js) |

`PUT /marks` takes `{ marks: { "<startup-id>": { visited, interested, note, changed_at } } }`, keeps
whichever edit is newer per startup, and answers the visitor's full list.

## Tested (test data world)

- Register: valid email is normalised and stored; invalid email answers 400.
- Two visitors marking the same startup each see only their own row.
- A stale edit (`changed_at` older than the stored one) does not overwrite; a newer one does.
- `GET /marks` without a session answers 401.
- An invalid startup id answers 400.
- Booth notes: a visitor sees only notes they wrote; a delete is kept as a tombstone; a stale edit
  does not overwrite; another visitor using the same note id gets their own row; anonymous calls
  answer 401.
- Profile: `PATCH /visitors/me` sets `own_startup` and `welcomed` on the caller's own row only.
