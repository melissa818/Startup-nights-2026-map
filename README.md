# Startup Nights 2026: interactive 3D booth map

An interactive 3D version of the official Startup Nights 2026 venue map and booth list
(`source/Venue_Map_with_Booth_List_SN26.pdf`).

- **Find a startup two ways.** Pick a name in the scrollable list on the right and the camera flies to
  its booth, or click a booth on the 3D floor plan to see who is there.
- **Places.** Search also finds rooms and areas (workshops, stages, bars, food, toilets, lounges,
  entrance, matchmaking, emergency exits); a "Places" filter lists them all. Choosing one highlights
  it on the map and shows a short card; tapping a room on the 3D map does the same.
- **Phones.** The list is a sheet over a full-screen map: pull it down to a slim search bar to see the
  whole map, pull it up (or tap the handle or the search box) to browse again.
- **Startup details.** Each selection shows a short description, category and a link to the startup's
  website (from web research, see below).
- **Track your visit.** Signed-in visitors mark booths as *visited* (turns green) or *interested*
  (turns blue with a star) and keep notes per startup. Filter the list by Starred, To visit, Visited
  or Notes, and export everything as a CSV after the event.
- **General notes.** The pencil next to the search box opens a notepad for anything not tied to a
  booth (people met, ideas, follow-ups): add, edit or delete notes. The Notes filter shows them
  together with the startups you wrote notes on, search covers them, and they are in the CSV export.
- **Live chat.** A public chat for everyone at the event ("Live chat" in the header; the speech
  bubble next to the search box on phones). Anyone can read it; signed-in visitors post under a chat
  name they choose (their email is never shown) and can add photos, which are resized on the device
  and stripped of location data. New messages arrive instantly for signed-in visitors and within a few
  seconds for everyone else; an unread badge counts what you missed. Authors can delete their messages
  and hosts (set with the `CHAT_MODERATORS` secret, see `backend/README.md`) can remove any message.
- **Privacy, terms and chat rules.** `site/legal.html` holds the privacy policy (Swiss FADP, GDPR
  where it applies), terms of use and chat rules for this independent demo. Signing in needs a ticked
  consent box (the acceptance is recorded), the chat repeats the key rules where people post, others'
  messages can be reported (three reports hide a message), and all data is deleted automatically on
  6 December 2026. The documents open in a window inside the app ("Privacy & terms" under the list,
  in the account window, in the chat) and as their own page.
- **Private by account.** Sign-in is a 6-digit email code. Marks and notes belong to the account and
  only its owner can read them (Langrove policies); signing out clears them from the device. Anyone
  can browse the map without an account.
- **Exhibitors.** On their own booth ("Exhibiting at this booth?"), signed-in exhibitors keep private
  notes on the people who stopped by: name, contact and feedback, exportable as CSV.
- **Share.** The Share button (next to Sign in) shows a QR code for the live site
  (https://startup-nights-2026.ttm.devcore.build), a Copy link button and WhatsApp, Messages and Email
  shortcuts, plus the device's own share menu where the browser offers one.
- **Delete account.** In the account window, "Delete my account" (with a confirmation step) removes
  the account and everything stored for it, on the server and on the device.
- **First sign-in.** New users see a one-line welcome and the Langrove booth highlighted; a small
  "Built with Langrove" tag on the map jumps to that booth.

## Structure

```
site/                    static web app (no build step)
  index.html
  css/app.css
  js/main.js             list, detail card, filters, sign-in, export
  js/scene.js            three.js scene: hall, rooms, seats, booths, picking, camera
  js/store.js            marks and notes: localStorage + sync with the backend
  js/chat.js             live chat: messages, photos, realtime and polling
  data/venue.json        geometry extracted from the PDF (217 booths, walls, rooms, seats, exits)
  data/startups.json     194 exhibitors with booths, description, website, category
  vendor/three/          three.js r170 (MIT)
backend/                 reference copy of the Langrove backend (models, policies, endpoints)
data-src/                booth list, web research, manual overrides
tools/extract_venue.py   PDF -> site/data/venue.json
tools/build_startups.py  booth list + research -> site/data/startups.json
source/                  the official PDF
```

## Run locally

```bash
cd site && python3 -m http.server 8000
# open http://localhost:8000
```

Locally there is no backend, so the sync button is hidden and marks stay on the device.

## Rebuild the data

```bash
pip install pdfplumber
python3 tools/extract_venue.py source/Venue_Map_with_Booth_List_SN26.pdf site/data/venue.json
python3 tools/build_startups.py
```

To correct or add a startup's details, edit `data-src/overrides.json` (it wins over the research file)
and rerun `build_startups.py`.

## Exhibitor research status

| status | count | shown as |
|---|---|---|
| verified | 86 | description + website link |
| partial | 11 | what was found, marked "Details unverified", plus a web-search link |
| pending | 88 | "could not verify yet" + web-search link |
| surprise | 9 | Surprise Startup booths |

Research was done with web search only (company sites could not be opened from the build
environment), so links in the *verified* group come from search results. A few profile pages
(startup.ch, Crunchbase, etc.) are used where no company site was found; the UI labels those
"View profile". Booth 223 (a Surprise Startup) is in the booth list but not drawn on the official
floor plan; the app says so.

## Deploying

The site is served by the Langrove project `startup-nights-2026` (see `backend/README.md`).
Publish the `site/` folder with the connector's `upload_site`. Dev updates immediately; staging and
production need a deploy from the Langrove console.
