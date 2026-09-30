# Architecture

## 1. Goals and constraints

Spotify Snooper is a low-throughput, correctness-oriented monitoring service. Its
job is to produce an understandable playlist history even when polls overlap,
Spotify rate-limits requests, or a process restarts midway.

The MVP optimizes for:

- one connected Spotify account, with a schema that can later support many;
- tens or hundreds of monitored playlists rather than internet-scale crawling;
- deployment on a single Hostinger host;
- durable state in MySQL or MariaDB;
- stateless web and worker processes;
- conservative Spotify API usage.

Full content monitoring is limited to playlists for which Spotify returns item
data. Under Spotify's current API documentation, that means playlists owned by
the authorized user or playlists where that user is a collaborator. Monitor
creation probes this capability and stores other accessible playlists as
`metadata_only` rather than treating a missing item collection as an empty
playlist. Metadata-only monitors poll and record title and description changes
without claiming to retain item history.

This is not a real-time system. A change can only be detected after the next
successful poll, and several edits between polls may appear as one transition.

## 2. System context

```text
                         +----------------------+
                         | Spotify Accounts API |
                         +----------+-----------+
                                    |
                                    | OAuth 2.0
                                    v
+---------+  HTTPS  +-------------------------------+  SQL  +---------------+
| Browser | <-----> | Spotify Snooper web process   | ----> | MySQL/MariaDB |
+---------+         +-------------------------------+       +-------+-------+
                                                                        ^
                                                                        | SQL
+----------------+       starts       +-------------------------------+ |
| Optional cron  | -----------------> | Spotify Snooper poll worker   |-+
+----------------+                    +---------------+---------------+
                                                     |
                                                     | HTTPS + Bearer token
                                                     v
                                          +---------------------+
                                          | Spotify Web API     |
                                          +---------------------+
```

Both application processes are disposable. The database is the source of truth
for schedules, leases, snapshots, events, and OAuth state.

Before serving requests or polling, both processes run the idempotent migration
runner. A fresh database is initialized automatically, while an existing database
applies only migration files not recorded in `schema_migrations`. Deployment does
not drop, truncate, or reseed application tables, so snapshots and change history
survive builds and restarts.

## 3. Components

### Web process

The web process owns:

- Spotify authorization start and callback routes;
- the encrypted session cookie or server-side session identifier;
- monitor creation, pause, resume, and deletion;
- dashboard and change-history rendering;
- readiness and liveness endpoints.

It does not run an in-memory polling timer. A timer would be lost on restarts and
could execute more than once if the web process were scaled.

### Poll worker

The worker is a finite command invoked by cron. It:

1. atomically leases a batch of due monitors;
2. groups work by Spotify connection to reuse a valid access token;
3. polls each leased playlist with bounded concurrency;
4. commits a result or records a categorized failure;
5. releases the lease and calculates `next_poll_at`;
6. exits after all claimed work is settled.

One playlist failure must not abort the batch. A global rate limit should stop
new Spotify calls and defer affected monitors according to `Retry-After`.

### Automatic scheduler

The web process checks for due monitors every few seconds and runs the same leased
polling batch as the finite worker. Database leases make this safe across multiple
web instances and an optional cron worker. A failed poll keeps `next_poll_at` due
and stores its retry cooldown in the lease-expiry field; only a confirmed success
advances `next_poll_at`. Due browser countdowns refresh status from the server and
reset only after observing that committed value.

### Spotify client

The Spotify client is the only module that knows Spotify HTTP details. It owns:

- access-token refresh and safe token rotation;
- request timeouts and response validation;
- pagination and bounded retry behavior;
- `429` handling;
- conversion from Spotify responses to internal types;
- redaction of authorization headers and tokens from logs.

### Monitoring service

The monitoring service owns scheduling, snapshot construction, comparison, and
event persistence. It operates on internal types and is independently unit
testable with stored fixtures.

## 4. Data model

Names are illustrative; migrations will be the source of truth.

### `users`

| Column | Notes |
| --- | --- |
| `id` | Internal UUID or sortable UUID |
| `created_at`, `updated_at` | Audit timestamps |

The MVP can seed one local application user. Explicit ownership avoids a painful
schema rewrite if application login or multiple users are added later.

### `spotify_connections`

| Column | Notes |
| --- | --- |
| `id`, `user_id` | Internal identity and owner |
| `spotify_user_id` | Stable external account identifier |
| `encrypted_refresh_token` | Application-level authenticated encryption |
| `granted_scopes` | Normalized scope string or JSON array |
| `reauthorization_required_at` | Set after permanent refresh failure |
| `created_at`, `updated_at` | Audit timestamps |

Prefer keeping short-lived access tokens in process memory. If they are persisted
to reduce refresh traffic, encrypt them as well.

### `monitored_playlists`

| Column | Notes |
| --- | --- |
| `id`, `user_id`, `spotify_connection_id` | Ownership |
| `spotify_playlist_id` | Unique with `user_id` |
| `status` | `active`, `paused`, `auth_required`, `not_found`, or `error` |
| `poll_interval_seconds` | Per-monitor cadence |
| `next_poll_at` | Indexed scheduler field |
| `lease_owner`, `lease_expires_at` | Crash-safe worker lease |
| `consecutive_failures`, `last_error_code` | Operations state |
| `last_polled_at`, `last_changed_at` | Dashboard state |
| `created_at`, `updated_at` | Audit timestamps |

### `playlist_snapshots`

| Column | Notes |
| --- | --- |
| `id`, `monitored_playlist_id` | Identity and parent |
| `spotify_snapshot_id` | Spotify's content version identifier |
| `name`, `description` | Metadata observed at this version |
| `content_hash` | Hash of the canonical ordered item sequence |
| `item_count` | Fast display and integrity check |
| `observed_at` | First observation time |

A row is written when observable metadata or canonical content changes. The app
must not assume that `spotify_snapshot_id` changes for title or description edits.

### `playlist_snapshot_items`

| Column | Notes |
| --- | --- |
| `snapshot_id`, `position` | Composite primary key |
| `spotify_item_uri` | Nullable for an unavailable entry |
| `item_type` | `track`, `episode`, or `unavailable` |
| `added_at`, `added_by_spotify_user_id` | Nullable source metadata |
| `occurrence_key` | Deterministic comparison key for duplicates |
| `item_metadata_json` | Minimal display metadata, not a raw API dump |

Storing each ordered occurrence is necessary because a playlist can contain the
same item more than once.

### `change_events`

| Column | Notes |
| --- | --- |
| `id`, `monitored_playlist_id` | Identity and parent |
| `from_snapshot_id`, `to_snapshot_id` | Observed transition |
| `event_type` | `title_changed`, `description_changed`, `item_added`, `item_removed`, or `items_reordered` |
| `event_data_json` | Old/new values, item identity, counts, or positions |
| `deduplication_key` | Unique deterministic key |
| `detected_at` | Detection time, not necessarily edit time |

### `poll_runs`

| Column | Notes |
| --- | --- |
| `id`, `monitored_playlist_id` | Identity and parent |
| `started_at`, `finished_at` | Duration |
| `outcome` | `unchanged`, `changed`, `rate_limited`, `auth_required`, or `failed` |
| `http_request_count` | API usage signal |
| `error_code`, `retry_at` | Sanitized diagnostic state |

Poll runs are operational records and should have a shorter retention period than
the user-facing history.

## 5. Polling and diff algorithm

### Fast metadata check

Request only the fields needed for the decision: identifier, name, description,
snapshot ID, and item total. Compare name and description with the latest local
snapshot.

If the Spotify snapshot ID is unchanged, record metadata differences if present,
update monitor timestamps, and stop. If it changed—or this is the initial poll—
fetch every item page.

### Canonicalization

For each playlist position, construct an internal item with:

- type;
- Spotify URI when present;
- `added_at` and adding user when available;
- a zero-based occurrence number among identical item URIs;
- only the display metadata the product needs.

Build `content_hash` from a versioned serialization of the ordered comparison
fields. Prefixing the hash input with a schema version allows canonicalization to
change without silently comparing incompatible formats.

### Diff semantics

1. Compare title and description independently.
2. Compare multisets of item URIs plus occurrence numbers for additions/removals.
3. Match surviving occurrences deterministically.
4. If the surviving ordered sequence differs, emit one reorder summary rather
   than an event for every shifted position.
5. Store the snapshot and all events in one transaction.

This makes a simple insertion produce an addition event, not a misleading reorder
event for every following item. Fixture tests must cover duplicates, unavailable
items, episodes, insertions, removals, replacements, and reorderings.

## 6. Scheduling and concurrency

The web scheduler runs continuously while the application is active. An optional
cron fallback should run at least as often as the smallest allowed polling
interval. Every polling batch claims rows matching:

```text
status = active
AND next_poll_at <= now
AND (lease_expires_at IS NULL OR lease_expires_at < now)
```

Claims must be atomic, using a transaction and row locks supported by the chosen
database version. Each lease has a random owner ID and short expiry so work can
recover after a killed process.

On success, `next_poll_at` is based on the configured interval plus small jitter.
Transient failures use exponential backoff capped at a reasonable maximum. A 429
retry must be no earlier than Spotify's `Retry-After`. Permanent auth errors set
`auth_required` and stop polling until the user reconnects.

## 7. Security

- Keep the Spotify client secret, encryption key, and session secret in
  server-side environment configuration.
- Encrypt refresh tokens with authenticated encryption and support key rotation.
- Validate OAuth `state`, use short-lived state records, and delete them after use.
- Use secure, HTTP-only, same-site cookies and rotate the session on login.
- Add CSRF protection to state-changing browser requests.
- Validate playlist IDs rather than interpolating arbitrary URLs.
- Use parameterized SQL and escape server-rendered content.
- Apply a restrictive Content Security Policy and standard security headers.
- Never log tokens, cookies, authorization codes, database credentials, or playlist
  descriptions without sanitization.
- Prefer a local CLI cron command. If cron must call HTTP, protect that endpoint
  with a strong, dedicated secret.
- Back up the database and test restoration before production launch.

Spotify metadata and artwork must retain Spotify attribution and links, and the
product must comply with the current Spotify Developer Policy.

## 8. HTTP surface

The first version can use HTML routes with small JSON endpoints as needed:

| Method and path | Purpose |
| --- | --- |
| `GET /` | Monitor dashboard |
| `GET /auth/spotify` | Begin authorization |
| `GET /auth/spotify/callback` | Validate callback and store connection |
| `POST /auth/spotify/disconnect` | Remove local connection state |
| `POST /playlists` | Validate and create a monitor |
| `GET /playlists/:id` | Current state and change history |
| `POST /playlists/:id/pause` | Pause polling |
| `POST /playlists/:id/resume` | Resume polling |
| `DELETE /playlists/:id` | Stop monitoring and apply retention policy |
| `GET /health/live` | Process liveness only |
| `GET /health/ready` | Database and configuration readiness |

If cron can only make HTTP requests, add `POST /internal/jobs/poll` behind a
dedicated secret and rate limit. It must not be an unauthenticated public route.

## 9. Observability and retention

Emit structured JSON logs with a request ID or poll-run ID. Record poll duration,
outcome, Spotify request count, response class, due-monitor backlog, retry times,
and sanitized errors. Never record token values.

Readiness should verify database connectivity but should not call Spotify. Initial
alerting can watch for repeated worker failures, stale `last_polled_at` values, or
a growing count of overdue monitors.

Suggested retention defaults:

- snapshots and change history: retain until the monitor is deleted;
- successful poll runs: 30 days;
- failed poll runs: 90 days;
- expired OAuth state and sessions: delete daily.

## 10. Deployment topology

### Recommended: Hostinger VPS

- A reverse proxy terminates TLS and forwards to the Node web process.
- A process manager or container restarts the web process.
- Cron invokes the finite worker command.
- MySQL/MariaDB is local or managed.
- Daily encrypted backups are stored separately from the server.

### Constrained managed/shared hosting

Use the same app only if the plan provides a supported Node runtime, environment
variables, MySQL, and cron execution. If cron can only make HTTP requests, use the
protected internal job route. Do not use a browser-driven scheduler or in-process
`setInterval`; neither provides durable execution.

## 11. Deferred decisions

- exact Hostinger plan and deployment mechanism;
- local application authentication beyond the initial single owner;
- notification channels and batching rules;
- snapshot and event export format;
- hard deletion versus delayed deletion for removed monitors;
- whether artwork is stored or only referenced from Spotify;
- minimum poll interval after measuring quota usage.

These decisions stay outside the MVP until deployment discovery or product needs
make one necessary.
