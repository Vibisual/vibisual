# Download observations

These records describe GitHub release-asset downloads. **They do not measure verified installations, unique users, or active users.** Those audience metrics are unavailable (`null`), not zero. Do not present download counts as adoption or advertising reach.

Collected daily and on manual runs by [the snapshot workflow](https://github.com/Vibisual/vibisual/blob/main/.github/workflows/traction.yml). The workflow refreshes this definition on every successful run.

| File | Definition |
| --- | --- |
| `snapshots/<UTC timestamp>.json` | Immutable observation of every public release asset's ID, name, release tag, cumulative `download_count`, and creation/update timestamps, plus collection start/end times and schema version. |
| `latest.json` | Exact copy of the most recent successful observation. |
| `traction.csv` | Legacy daily summary, retaining its existing columns and historical rows. `downloads_total` counts application-package downloads, including macOS updater ZIPs. |
| `traffic.csv` | Repository page views/visitors and source-code clones/cloners from the authorized GitHub traffic API; neither represents app usage. Blank fields mean unavailable. |
| `badge-stars.json`, `stars-*.svg` | Repository star count and its history. |

## Definitions and limits

- `allAssetDownloads` sums all public release assets. `packageDownloads` and the legacy `downloads_total` include EXE/MSI, DMG/PKG/mac ZIP, AppImage/DEB/RPM/Snap. The three platform CSV columns use the same classification. Public prereleases are included in totals; drafts are excluded. `latest_tag` refers only to a stable public release.
- `updateMetadataDownloads` / legacy `update_checks` count YML/YAML downloads. An installed app can check repeatedly, and automation can request the same files. **This is not a lower bound on installations or active users.** Blockmaps and other assets have separate totals in JSON.
- Every count is the upstream cumulative download count. Updates, repeat downloads, CI, bulk fetches, bots, and incomplete installations may contribute. There are no arbitrary baseline deductions or estimated user counts.
- Snapshot schema version 1 explicitly records `audience.verifiedInstallations: null` and `audience.activeUsers: null`. No app-usage telemetry is collected by this workflow. See the [application privacy policy](https://github.com/Vibisual/vibisual/blob/main/PRIVACY.md).
- Match consecutive observations by **asset ID**, not just filename, to inspect changes. Removed or replaced assets can make aggregate totals decrease. A new asset's first observed count may include downloads before collection. Counts and timestamps alone cannot identify who downloaded or why.
- GitHub pagination is collected completely and validated before any files are written. Missing/malformed pages, duplicate IDs, invalid counts, and arithmetic overflow fail the run. The safety page limit fails explicitly rather than publishing a partial total. Collection is an observation window, not an atomic transaction across GitHub; concurrent upstream changes can still affect it.
- Archives are never overwritten by the generator; `latest.json` and today's CSV row can change. Git commit history provides an audit trail, not independent third-party certification. Review the asset-level evidence and collection time before using it in investor or advertiser materials.
- Historic CSV rows are preserved, not retroactively reconstructed or certified. Older rows may have included drafts, and older traffic rows may have used zero for an unavailable endpoint. Per-asset evidence starts with the first JSON archive; earlier asset-level changes cannot be reconstructed from aggregate CSV values.
- Repository traffic is optional and requires `METRICS_TOKEN`; absent/invalid traffic data remains unavailable. GitHub retains traffic for a limited window, so gaps older than that window cannot be backfilled.

Reproduce the counts by summing each archived `releases[].assets[].download_count` according to the [collector's extension classification](https://github.com/Vibisual/vibisual/blob/main/.github/scripts/traction-data.mjs). The collector requests JSON metadata only; it does not download release assets or increment their counters itself.
