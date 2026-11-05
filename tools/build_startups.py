#!/usr/bin/env python3
"""Build site/data/startups.json from the official booth list and the web research.

Inputs
  data-src/booth-list.txt   "Name|booth,booth" per line, transcribed from page 2 of the PDF
  data-src/research.json    one record per exhibitor: website, description, category, confidence, source
  data-src/overrides.json   hand-checked corrections that win over research.json

Usage:  python3 tools/build_startups.py
"""
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent

# Pages that describe a company without being its own site.
PROFILE_HOSTS = (
    "startup.ch", "crunchbase.com", "linkedin.com", "wikipedia.org", "producthunt.com",
    "pitchbook.com", "venturelab.swiss", "business-monitor.ch", "coursereport.com",
    "f4.fund", "bouncewatch.com", "mtec-sc.org", "terrapinn.com", "i3p.it",
    "netzerocompare.com", "wemakeit.com", "sihlcity.ch",
)

# Research text that only says nothing was found is not a description.
PLACEHOLDER = re.compile(r"^(no verifiable|not researched|not verified;|startup exhibiting|company \(gmbh\) exhibiting|agency exhibiting|business community/network exhibiting|health-focused startup;|nutraceutical \(dietary supplement\) company;|technology company \(ag\);|it product \(fortcontrol\))", re.I)


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def main():
    research = {r["id"]: r for r in json.loads((ROOT / "data-src/research.json").read_text())}
    overrides = json.loads((ROOT / "data-src/overrides.json").read_text())
    out = []
    for line in (ROOT / "data-src/booth-list.txt").read_text().strip().splitlines():
        name, booths = line.split("|")
        booths = booths.split(",")
        if name == "Surprise Startup":
            out.append({"id": f"surprise-{booths[0]}", "name": name, "booths": booths, "status": "surprise",
                        "category": None, "description": None, "website": None, "websiteKind": None})
            continue
        sid = slug(name)
        r = dict(research.get(sid, {}))
        r.update(overrides.get(sid, {}))
        desc = (r.get("description") or "").strip() or None
        if desc and PLACEHOLDER.match(desc):
            desc = None
        website = r.get("website") or None
        kind = None
        if website:
            host = urlparse(website).hostname or ""
            kind = "profile" if any(host == h or host.endswith("." + h) for h in PROFILE_HOSTS) else "official"
        conf = r.get("confidence") or "low"
        if conf in ("high", "medium") and desc:
            status = "verified"
        elif desc or website:
            status = "partial"
        else:
            status = "pending"
        out.append({
            "id": sid, "name": name, "booths": booths, "status": status,
            "category": r.get("category") if status != "pending" else None,
            "description": desc, "website": website, "websiteKind": kind,
        })
    ids = [s["id"] for s in out]
    assert len(ids) == len(set(ids)), "duplicate ids"
    (ROOT / "site/data/startups.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    counts = {}
    for s in out:
        counts[s["status"]] = counts.get(s["status"], 0) + 1
    print(len(out), counts)


if __name__ == "__main__":
    main()
