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
| terms_version / terms_accepted_at | string / number | which version of the terms and privacy policy they accepted, and when (epoch ms) |

**BoothMark**: one row per visitor and startup.

| field | type | notes |
|---|---|---|
| id | uuid | |
| visitor | relation → Visitor | |
| startup | string | startup id slug from `site/data/startups.json` |
| visited | boolean | no longer set by the app (only the star is used); kept for older marks |
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

**Note**: a visitor's general notes, not tied to a startup (people met, ideas, follow-ups).

| field | type | notes |
|---|---|---|
| id | uuid | |
| owner | relation → Visitor | the author; only they can read it |
| client_id | string | id made on the device; unique with owner |
| text | text | up to 8000 characters |
| created_at / changed_at | number | epoch ms; newest edit wins |
| deleted | boolean | tombstone, so a delete reaches the author's other devices |

**Feedback**: feedback for the Langrove team, from the form or through the AI assistant.

| field | type | notes |
|---|---|---|
| id | uuid | |
| visitor | relation → Visitor | set only when the sender was signed in |
| message | text | up to 2000 characters |
| rating | number | optional, 1-5 |
| contact | string | optional name or email, only if the sender wants a reply |
| source | string | `form` or `assistant` |
| created_at | number | epoch ms |

**AssistantUse**: when a question was asked or feedback sent, for usage limits. No content.

| field | type | notes |
|---|---|---|
| id | uuid | |
| client | string | random id the browser keeps (localStorage `sn26.client`) |
| visitor | relation → Visitor | set only when signed in |
| kind | string | `question` or `feedback` |
| created_at | number | epoch ms |

Indexes on `(created_at)` and `(client, created_at)`.

**ChatMessage**, **ChatReport**: from the public chat that the AI assistant replaced. No endpoint
reads or writes them any more; their rows (and chat photos) are deleted with an account and by the
retention cleanup on 6 December 2026, after which the two models can be removed.

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
| `note.read` / `create` / `update` / `delete` | allow when `resource.owner` is the signed-in Visitor |
| `feedback.read` / `create`, `assistantuse.read` / `create` | no rules: nobody. The endpoints and the `save_feedback` block write with `policy: false`; `list_feedback` reads with it after checking the caller is a host |
| `feedback.delete` / `assistantuse.delete` | allow when `resource.visitor` is the signed-in Visitor, or the flow `retention_cleanup` |
| `chatmessage.*` / `chatreport.*` (retired chat) | author / reporter only, plus delete for `retention_cleanup` |
| every model's `delete` (`visitor`, `boothmark`, `boothnote`, `note`) | also allow the flow `retention_cleanup` |
| `visitor.read` / `visitor.update` / `visitor.delete` | allow when the resource is the signed-in Visitor |

So a person can only ever read or write their own marks, booth notes and general notes. Feedback is
write-only: only hosts (emails listed in the `HOST_EMAILS` secret) can read it.

## Endpoints

| method | path | callers | code |
|---|---|---|---|
| POST | `/visitors` | anyone | [register_visitor.js](endpoints/register_visitor.js) |
| GET | `/visitors/me` | Visitor | [get_me.js](endpoints/get_me.js) |
| PATCH | `/visitors/me` | Visitor | [update_me.js](endpoints/update_me.js) |
| DELETE | `/visitors/me?confirm=delete-my-account` | Visitor | [delete_me.js](endpoints/delete_me.js) |
| GET | `/marks` | Visitor | [list_marks.js](endpoints/list_marks.js) |
| PUT | `/marks` | Visitor | [save_marks.js](endpoints/save_marks.js) |
| GET | `/booth-notes` | Visitor | [list_booth_notes.js](endpoints/list_booth_notes.js) |
| PUT | `/booth-notes` | Visitor | [save_booth_notes.js](endpoints/save_booth_notes.js) |
| GET | `/notes` | Visitor | [list_notes.js](endpoints/list_notes.js) |
| PUT | `/notes` | Visitor | [save_notes.js](endpoints/save_notes.js) |
| POST | `/assistant/messages` | anyone | [ask_assistant.js](endpoints/ask_assistant.js) |
| POST | `/feedback` | anyone | [send_feedback.js](endpoints/send_feedback.js) |
| GET | `/feedback` | Visitor (hosts only) | [list_feedback.js](endpoints/list_feedback.js) |
| DELETE | `/sessions/current` | Visitor | [end_session.js](endpoints/end_session.js) |

Flow **Retention cleanup** (`retention_cleanup`, schedule `41 2 * * *`, no URL):
[flows/retention_cleanup.js](flows/retention_cleanup.js).

`PUT /marks` takes `{ marks: { "<startup-id>": { visited, interested, note, changed_at } } }`, keeps
whichever edit is newer per startup, and answers the visitor's full list.

## AI assistant

- **Agent** `booth_assistant` ([agents/booth_assistant.md](agents/booth_assistant.md)): Claude Haiku 5.5
  through the access `anthropic` (an `api-key` access whose key is the project secret
  `ANTHROPIC_API_KEY`, set by a person in the console). Tools: [search_map](blocks/search_map.js),
  [save_feedback](blocks/save_feedback.js) and [answer](blocks/answer.js), which ends the turn with
  `{ text, startups, places, feedback_saved }`.
- **Directory**: `search_map` reads `site/data/assistant.json` from the app's own site. It is built
  by `tools/build_assistant_data.py` from the booth list and floor plan: each startup and place with
  its part of the hall and nearest landmarks. Rerun it when the booth list changes.
- **Asking**: `POST /assistant/messages { message, history: { turns }, client }` runs the agent
  (12.5 s budget). The browser keeps the conversation in `sessionStorage` and sends the last 8 turns.
  Questions are not stored; `AssistantUse` records only when, for limits: 60 questions a minute in
  total, 10 a minute and 200 a day per browser. Without the agent (no key yet) it answers 503 and the
  app answers from the map's own data instead.
- **Feedback**: the agent's `save_feedback` tool, or the form (`POST /feedback`, 5 per 10 minutes per
  browser). Hosts read it in the app (account window → "Read the feedback people sent") once their
  email is in the project secret **`HOST_EMAILS`** (comma separated).
- Dev, staging and production share the same live data.

## Terms, privacy and data retention

- The privacy policy, terms of use and AI assistant notes are in `site/legal.html` (version
  `2026-11-05b`). The sign-in form has a required checkbox; after sign-in the app sends
  `PATCH /visitors/me { accept_terms: "2026-11-05b" }`, which records the version and time. Accounts
  without the current version are asked to accept or sign out. When the documents change, bump the
  version in `site/js/store.js` (`TERMS_VERSION`) and `update_me` together, and everyone is asked again.
- **Retention**: the flow `retention_cleanup` runs daily and from 6 December 2026, 00:00 Swiss time,
  deletes every row of every model (feedback, usage records, notes, accounts, old chat rows and photos). Before that date it does
  nothing. Like any schedule it only runs once the project is deployed to staging or production.

## Tested (test data world)

- Register: valid email is normalised and stored; invalid email answers 400.
- Two visitors marking the same startup each see only their own row.
- A stale edit (`changed_at` older than the stored one) does not overwrite; a newer one does.
- `GET /marks` without a session answers 401.
- An invalid startup id answers 400.
- Booth notes: a visitor sees only notes they wrote; a delete is kept as a tombstone; a stale edit
  does not overwrite; another visitor using the same note id gets their own row; anonymous calls
  answer 401.
- General notes: a visitor sees only notes they wrote; edits and deletes (tombstones) sync; a stale
  edit does not overwrite; anonymous calls answer 401.
- AI assistant (before the API key exists): `POST /assistant/messages` answers 503 and logs why ("no
  agent"); `search_map` finds booth 82 (Langrove, lower right, near the Cocktail Bar and the Food
  Area), both toilet areas, and eight robotics startups; `save_feedback` stores a row linked to the
  signed-in visitor; `answer` drops invalid ids.
- Feedback: the form stores a row (rating 5); an empty message answers 400; a non-host reading
  `GET /feedback` gets 403.
- Retired chat (tested before it was replaced): posting needed a chat name (400 without); names are cleaned and must be 2-30 characters; a
  photo message answers an upload URL, the uploaded bytes come back unchanged, and it stays hidden
  from anonymous readers until its author publishes it (another visitor gets 404); GIFs are refused;
  anonymous readers see published messages; another visitor cannot delete a message (403), the author
  can, and the photo is gone from storage afterwards; a host can remove anyone's message; removals
  show as tombstones to `?after=` readers; anonymous deletes answer 401; the 9th message within a
  minute answers 429; deleting an account deletes its chat messages (8 in the test).
- Terms: posting without accepting answers 403; accepting an old version answers 400; accepting the
  current one records version and time, after which posting works.
- Reports: a second report by the same person does not count again; reporting your own message and an
  unknown reason answer 400; hosts' count goes 1, 2, and the 3rd report from a different person removes
  the message (tombstone for readers).
- Retention flow: before the cutoff it returns `skipped`; a forced test run deleted every row of every
  model in the test world (4 visitors, 4 messages, 3 reports, notes and marks). A session whose
  account is gone gets 401 from `GET /visitors/me`, so the app signs out.
- Profile: `PATCH /visitors/me` sets `own_startup` and `welcomed` on the caller's own row only.
- Delete account: without `confirm=delete-my-account` it answers 400 and deletes nothing; anonymous
  answers 401; with it, the caller's Visitor row, marks, booth notes and general notes are deleted (2 + 2 rows in the
  test) and another visitor's rows are untouched. Signing in again with the same email starts a new,
  empty account.
