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
| display_name | string | the name shown with their chat messages (2-30 characters); the email is never shown |

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

**Note**: a visitor's general notes, not tied to a startup (people met, ideas, follow-ups).

| field | type | notes |
|---|---|---|
| id | uuid | |
| owner | relation → Visitor | the author; only they can read it |
| client_id | string | id made on the device; unique with owner |
| text | text | up to 8000 characters |
| created_at / changed_at | number | epoch ms; newest edit wins |
| deleted | boolean | tombstone, so a delete reaches the author's other devices |

**ChatMessage**: the public live chat.

| field | type | notes |
|---|---|---|
| id | uuid | |
| author | relation → Visitor | |
| name | string | the author's chat name when they posted |
| text | text | up to 1000 characters |
| image | file | optional photo (resized to at most 1600 px and re-encoded as JPEG on the device) |
| image_w / image_h | number | photo size in pixels, so readers reserve space before it loads |
| host | boolean | posted by a chat host (shown with a "Host" badge) |
| published | boolean | false while a photo is still uploading; only published messages are public |
| deleted | boolean | tombstone after the author or a host removed it (text and photo are cleared) |
| created_at / changed_at | number | epoch ms; readers poll by `changed_at` |

Indexes on `(published, changed_at)`, `(published, created_at)` and `(author, created_at)`.

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
| `chatmessage.read` | allow when `resource.published` is true (anyone, signed in or not), or the caller is the author |
| `chatmessage.create` / `update` / `delete` | allow when `resource.author` is the signed-in Visitor |
| `visitor.read` / `visitor.update` / `visitor.delete` | allow when the resource is the signed-in Visitor |

So a person can only ever read or write their own marks, booth notes and general notes; anonymous callers get
nothing except the published chat messages. A chat host removing someone else's message is checked in
`delete_chat` (the caller's email must be in the `CHAT_MODERATORS` secret) before an unfenced update.

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
| GET | `/chat/messages` | anyone | [list_chat.js](endpoints/list_chat.js) |
| POST | `/chat/messages` | Visitor | [send_chat.js](endpoints/send_chat.js) |
| POST | `/chat/messages/:id/publish` | Visitor | [publish_chat_photo.js](endpoints/publish_chat_photo.js) |
| DELETE | `/chat/messages/:id` | Visitor | [delete_chat.js](endpoints/delete_chat.js) |
| DELETE | `/sessions/current` | Visitor | [end_session.js](endpoints/end_session.js) |

`PUT /marks` takes `{ marks: { "<startup-id>": { visited, interested, note, changed_at } } }`, keeps
whichever edit is newer per startup, and answers the visitor's full list.

## Live chat

- **Reading** is open to everyone. `GET /chat/messages` answers the newest 60 messages; `?before=` pages
  back, `?after=` answers what was added or removed since a time (readers poll with it), `?ids=` answers
  fresh photo links (they expire after 5 minutes).
- **Live updates**: a signed-in reader's first `GET /chat/messages` grants their session the realtime
  channel `chat/public`; the site listens with `/_devcore/client.js`. Sending, publishing a photo and
  removing a message broadcast `{ chat: 1, type: 'message' | 'deleted', ... }` there. Anonymous readers
  (realtime needs a session) and anyone whose connection drops poll every few seconds while the chat
  is open, and every minute otherwise for the unread badge.
- **Posting** needs a sign-in and a chat name. Photos: `POST /chat/messages` with `image` answers an
  upload URL; the browser `PUT`s the JPEG there, then `POST /chat/messages/:id/publish` shows it.
  At most 8 messages a minute per person.
- **Hosts**: set the project secret **`CHAT_MODERATORS`** in the Langrove console to the hosts' email
  addresses (comma separated). Hosts can remove any message and their messages carry a "Host" badge.
  A changed value applies within a minute; the secret reaches staging and production with the next deploy.
- Dev, staging and production share the same live data, so messages posted on dev appear on
  production too.

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
- Chat: posting needs a chat name (400 without); names are cleaned and must be 2-30 characters; a
  photo message answers an upload URL, the uploaded bytes come back unchanged, and it stays hidden
  from anonymous readers until its author publishes it (another visitor gets 404); GIFs are refused;
  anonymous readers see published messages; another visitor cannot delete a message (403), the author
  can, and the photo is gone from storage afterwards; a host can remove anyone's message; removals
  show as tombstones to `?after=` readers; anonymous deletes answer 401; the 9th message within a
  minute answers 429; deleting an account deletes its chat messages (8 in the test).
- Profile: `PATCH /visitors/me` sets `own_startup` and `welcomed` on the caller's own row only.
- Delete account: without `confirm=delete-my-account` it answers 400 and deletes nothing; anonymous
  answers 401; with it, the caller's Visitor row, marks, booth notes and general notes are deleted (2 + 2 rows in the
  test) and another visitor's rows are untouched. Signing in again with the same email starts a new,
  empty account.
