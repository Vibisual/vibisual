# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- IDE window no longer overlays onto other projects; each project keeps its own window state independently.
- Custom delegation edge dispatch no longer fails with 401 Unauthorized. The loopback hook listener now exempts the `/api/task-edges/dispatch` route from the per-launch token gate, since external `claude` subagent processes have no channel to receive that token. The route remains safe because the listener binds to 127.0.0.1 only and the dispatch handler still validates the edge ID and target agent.

### Removed
- Dropped preset options from the custom agent settings.
