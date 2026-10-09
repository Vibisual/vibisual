# Vibisound dependencies

Vibisound uses the existing workspace dependencies; no model or plugin is bundled.

| Dependency | License | Use |
| --- | --- | --- |
| Express | MIT | Local app routes |
| Mediabunny | MPL-2.0 | Read audio container metadata; used unmodified as an npm dependency |
| @vibisual/shared | Apache-2.0 | Host contracts and shared utilities |

Audio decoding uses the host browser's Web Audio API. Editing and WAV output are project-owned code.
