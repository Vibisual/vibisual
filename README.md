# Traction snapshots

Appended once a day by `.github/workflows/traction.yml` on `main`.

| File | What it holds |
| --- | --- |
| `traction.csv` | One row per day: stars, forks, watchers, releases, download totals. |
| `traffic.csv` | One row per day: views, unique visitors, clones, unique cloners. |
| `badge-*.json` | shields.io endpoint payloads used by the README badges. |
| `stars-*.svg` | The star-history curve the README embeds, light and dark. |

Every number here is public data that GitHub already exposes — stars, forks,
watchers, release asset download counts, and this repository's own traffic.
The application itself collects nothing; see PRIVACY.md on `main`.

`update_checks` counts downloads of the `latest*.yml` release assets.
electron-updater fetches those files when an installed copy checks for an
update, so the number is a lower bound on installs that are still running —
not a user count, and not tied to any individual. It is kept out of
`downloads_total`, which counts installers only.

`traffic.csv` is blank until a `METRICS_TOKEN` secret exists: the traffic
endpoints need repository administration read, which the workflow's built-in
token cannot be granted. GitHub keeps only 14 days of traffic, so days before
the first successful run cannot be recovered.
