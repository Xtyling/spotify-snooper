# Spotify Snooper

Spotify Snooper is a web app that watches selected Spotify playlists and records
changes to their title, description, tracks or episodes, and item order.

The app is designed for deployment on Hostinger. A small web process serves the
dashboard and handles Spotify OAuth, while a scheduled worker polls Spotify's
Web API and persists an audit trail in a MySQL-compatible database.

> Status: minimal working scaffold. It includes the owner dashboard, Spotify
> OAuth, MySQL persistence, initial snapshots, change detection, and poll worker.

## MVP scope

1. Connect one Spotify account using OAuth.
2. Accept a Spotify playlist URL or playlist ID.
3. Start, pause, resume, and remove a playlist monitor.
4. Poll active monitors on a configurable schedule.
5. Record title, description, item, and ordering changes.
6. Show a chronological change history and actionable polling errors.

Notifications, multiple application users, and exports are deliberately deferred.

## Spotify platform constraints

The MVP should promise full content monitoring only for playlists owned by the
connected Spotify user or playlists where that user is a collaborator. Spotify's
current Get Playlist documentation says the `items` field is available only in
those cases. A playlist that exposes metadata but not items can still be rejected
with an explanatory message or monitored for metadata only; the implementation
must detect the capability instead of silently reporting an empty playlist.

New Spotify apps begin in development mode. Spotify currently limits that mode to
a small allowlist of authenticated users and requires the app owner to have
Premium. Treat wider public access as a later launch concern that may require
Spotify quota approval.

## Proposed stack

| Area | Choice | Reason |
| --- | --- | --- |
| Runtime | Node.js 20+ and TypeScript | One language for the web app and worker |
| HTTP server | Fastify | Small, typed, and suitable for a long-running process |
| UI | Server-rendered HTML with progressive enhancement | Simple deployment and authentication boundary |
| Database | MySQL 8 or MariaDB | A natural fit for Hostinger and this workload |
| Data access | Drizzle ORM and SQL migrations | Typed queries without hiding the schema |
| Validation | Zod | Shared configuration and request validation |
| Tests | Vitest | Fast TypeScript unit and integration tests |
| Scheduling | Hostinger cron calling a worker command | Independent of web-process uptime |

The web process and worker share one codebase and database:

```text
npm run start             # start the HTTP server
npm run worker:poll       # claim and poll due monitors, then exit
```

A Hostinger VPS is the most predictable target. A managed/shared plan is viable
only if it supports a persistent Node.js app, MySQL, environment variables, and
a cron job that can execute Node.js commands. Confirm those capabilities for the
specific plan before implementation or deployment.

## Polling model

Spotify does not push playlist-change events to this app, so a scheduled worker
finds changes by polling:

```text
Hostinger cron
    -> poll worker
        -> atomically claim due monitors
        -> refresh the Spotify access token when needed
        -> fetch playlist name, description, and snapshot_id
        -> record metadata changes
        -> if snapshot_id changed, fetch every item page
        -> diff the canonical item sequence against the previous snapshot
        -> store added, removed, and reordered events
        -> schedule the next poll
```

Every poll reads title and description because a content snapshot should not be
treated as the sole signal for metadata changes. The complete item list is only
downloaded when `snapshot_id` changes, reducing API usage.

The worker must paginate all items, preserve duplicates and ordering, tolerate
unavailable items, and respect Spotify's `429` response and `Retry-After` header.
Database leases prevent overlapping cron runs from polling the same monitor.

See [docs/architecture.md](docs/architecture.md) for the component design, data
model, diff rules, security boundaries, and deployment topology.

## Spotify authorization

The server uses Spotify's Authorization Code flow. The client secret and refresh
token never reach browser JavaScript.

Expected MVP scopes:

- `playlist-read-private` for private playlists;
- `playlist-read-collaborative` for collaborative playlists.

OAuth callbacks must validate `state`, and refresh tokens must be encrypted at
rest. The UI and worker must support a clear **Reconnect Spotify** state when a
refresh token is expired or revoked instead of retrying forever.

## Local setup

Requirements: Node.js 20+, a MySQL 8/MariaDB database, Spotify Premium, and a
Spotify Developer application.

```bash
npm install
cp .env.example .env
npm run build
npm run db:migrate
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.
Configure the exact value of `SPOTIFY_REDIRECT_URI` in the Spotify Developer
Dashboard, open the local site, enter `ADMIN_PASSWORD`, and connect Spotify.

Run one polling batch manually with:

```bash
npm run worker:poll:dev
```

## Configuration

The app will validate these environment variables at startup:

```dotenv
NODE_ENV=production
PORT=3000
APP_BASE_URL=https://example.com
DATABASE_URL=mysql://user:password@host:3306/spotify_snooper
SESSION_SECRET=replace-with-a-long-random-value
TOKEN_ENCRYPTION_KEY=replace-with-a-32-byte-key
ADMIN_PASSWORD=replace-with-a-long-dashboard-password
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
SPOTIFY_REDIRECT_URI=https://example.com/auth/spotify/callback
POLL_INTERVAL_MINUTES=10
POLL_BATCH_SIZE=20
```

`SPOTIFY_REDIRECT_URI` must exactly match a redirect URI configured in Spotify's
Developer Dashboard. Secrets belong in Hostinger's server-side environment or
secret configuration, never in Git.

Generate the encryption key with `openssl rand -base64 32`.

## Project layout

```text
src/
  app.ts               HTTP routes and owner authentication
  config.ts            Validated environment configuration
  db/                  MySQL pool, migrations, and repository
  lib/                 Encryption, HTML, and playlist-ID utilities
  monitoring/          Poll orchestration and deterministic diffing
  spotify/             OAuth and typed Spotify API client
  views.ts             Minimal server-rendered dashboard
  worker.ts            Cron-safe polling entry point
tests/
  fixtures/            Spotify response and diff fixtures
  integration/
  unit/
docs/
  architecture.md
migrations/
  001_initial.sql
```

## Hostinger deployment

1. Create a MySQL database and user in hPanel.
2. Set `DATABASE_URL` from the hPanel database host, name, user, and password.
3. Configure the remaining values from `.env.example` as server-side environment
   variables.
4. Run `npm ci`, `npm run build`, and `npm run db:migrate` during deployment.
5. Start the web process with `npm start`.
6. Add a Hostinger cron job that runs `npm run worker:poll` from the application
   directory every minute. The database decides which playlists are actually due.

Do not expose `.env` from the web root. On shared hosting, confirm that the plan
supports a persistent Node.js process and Node commands in cron. Otherwise deploy
the same project on a Hostinger VPS.

## Delivery plan

### Phase 1: foundation

- Scaffold TypeScript, Fastify, linting, formatting, and tests.
- Add configuration validation, structured logging, and health endpoints.
- Create the initial database schema and migrations.

### Phase 2: Spotify connection

- Add secure sessions and the Authorization Code flow.
- Encrypt refresh tokens before database storage.
- Validate playlist URLs/IDs and perform the initial playlist lookup.

### Phase 3: monitoring

- Implement the Spotify client, pagination, and rate-limit handling.
- Implement monitor leases, polling, snapshots, and deterministic diffing.
- Test additions, removals, duplicate items, and reorderings with fixtures.

### Phase 4: dashboard and operations

- Build the monitor list, playlist detail, history, and error states.
- Add the cron command, retention policy, backups, and deployment runbook.
- Run an end-to-end test against a dedicated test playlist.

## MVP definition of done

- A connected user can add, pause, and resume a playlist monitor.
- Repeated or overlapping worker runs do not duplicate change events.
- Title, description, add, remove, and reorder changes appear in the dashboard.
- An unchanged playlist causes neither a full item download nor a new snapshot.
- Rate limits, expired authorization, missing/private playlists, and partial API
  failures produce actionable states.
- Secrets and Spotify tokens are never logged or sent to the browser.
- Migrations, automated tests, and Hostinger deployment instructions ship with
  the implementation.

## Spotify references

- [Authorization](https://developer.spotify.com/documentation/web-api/concepts/authorization)
- [Authorization Code flow](https://developer.spotify.com/documentation/web-api/tutorials/code-flow)
- [Get Playlist](https://developer.spotify.com/documentation/web-api/reference/get-playlist)
- [Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
- [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Spotify Developer Policy](https://developer.spotify.com/policy)

## License

This project is licensed under the terms in [LICENSE](LICENSE).
