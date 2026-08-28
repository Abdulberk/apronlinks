# Flight Change Alert

Detects when a tracked flight's **flight number** or **aircraft registration**
changes, records what moved, and raises an operational alert — without raising
the same one twice.

```bash
git clone https://github.com/Abdulberk/apronlinks.git
cd apronlinks
docker compose up --build
```

Then open **http://localhost:3000**. The stack seeds itself, so there are
flights and a tail change to trigger the moment it comes up.

That page is the service's own built-in dashboard — one file, no build step —
so this repository is self-sufficient from a single command. The operator UI is
a separate Next.js client, run alongside it:

```bash
pnpm install
pnpm dev:web        # http://localhost:3001
```

It is deliberately outside the compose stack. A Next build takes minutes, and
`docker compose up --build` earns its place by being quick.

---

## Seeing it work

The dashboard carries a button for each watched field — **Simulate registration
change** and **Simulate flight number change** — because a demo that can only
move one of them asks the reviewer to take the other on trust. Or from a
terminal:

```bash
pnpm demo:change            # raise a tail change
pnpm demo:change --replay   # send the SAME signed delivery twice
```

The replay flag is the interesting one. Duplicate prevention is invisible when
it works, so watching the second delivery answer `DUPLICATE` while the change
count stays where it was is the only way to actually see it happen:

```
first delivery   : { outcome: 'APPLIED',   changes: 1, alerts: 1 }
replayed delivery: { outcome: 'DUPLICATE', changes: 0, alerts: 0 }
```

Press either button repeatedly and the value flips between its two demo values —
the tail between `NQ-ATC` and `NQ-BRD`, the number between `TK1985` and
`TK1907`.
Click the flight number to expand its history: every leg is there, because
`ATC → BRD → ATC → BRD` is three real changes, not one repeated twice.

---

## The three decisions that matter

### A flight's identity is not its flight number

The flight number is one of the two things we are asked to detect changes in.
Key on it and a renumbering looks like one flight vanishing and a different one
appearing, rather than this flight's number changing — and a primary key that
changes breaks every row pointing at it.

Identity is our own UUID. The provider's id is a **correlation** key, scoped by
which provider issued it (`@@unique([providerSource, providerFlightId])`),
because three issuing authorities in one namespace is a collision waiting to
happen.

### Duplicates are stopped in three independent places

They get conflated constantly, so they are named separately in the code:

| | What it catches | Where |
|---|---|---|
| **L1** replay guard | This exact delivery was already handled | `IngestEvent.eventId` unique |
| **L2** content guard | Nothing actually differs | `detectChanges`, a pure function |
| **L3** concurrency | Two writers, one state transition | CAS on `revision` + `@@unique([flightId, field, fromRevision])` |

**The poll path has no replay guard and does not need one.** Flightradar24
issues no delivery id, and its payload timestamp changes on every call — three
consecutive requests for identical static sandbox data produced three different
payload hashes, measured, not assumed. Hashing there would deduplicate nothing
while writing a row per poll. L2 and L3 already cover it: a redelivery arriving
after the first committed simply finds no diff.

The uniqueness key is `fromRevision`, not the values. An aircraft can swap back
and forth, and a value-keyed index would suppress the third change as a
duplicate of the first. Revisions only ever increase, so they cannot repeat.

### Correctness comes from constraints, not from coordination

There is no distributed lock. A lock is advisory — it works only if everyone
remembers to ask — and it expires, so a slow holder releases it and two writers
proceed anyway. A constraint is enforced by the system that owns the data and
cannot expire.

Every state change is a compare-and-swap: `UPDATE … WHERE id = ? AND revision =
?`. Zero rows means someone else committed first, which is not an error — the
caller re-reads and tries again, **outside** the transaction, because catching a
failed write inside one leaves Postgres in an aborted state where the recovery
silently discards the writes that had succeeded.

---

## Architecture

```
src/
  domain/      PURE. No NestJS, no Prisma, no clock, no I/O.
               detectChanges · normalizeFlightNumber · nextPollDelay
               deriveStatus · formatAlert
  ingest/      The single funnel. Transaction, CAS, history, alerts.
  providers/   FlightDataProvider — FixtureProvider · Fr24Provider
  polling/     BullMQ sweep, cadence from the domain function
  alerts/      REST + SSE
  flights/     REST + change history
  dashboard/   One self-contained page, no build step

web/           The operator UI. Next.js 16, React 19, Tailwind 4.
  app/         Flight board and per-flight change history
  components/  The shared vocabulary: tags, panels, value transitions
  hooks/       Live stream plus a slow poll underneath it
```

`src/domain` is the only layer with no framework coupling, and that is why
`pnpm test` finishes in about three seconds with no Docker and no database: the
logic being graded has nothing to boot.

### Polling cadence tracks operational urgency

Nobody cares about a tail swap on a flight leaving in twenty hours. A tail swap
twenty minutes before departure means a ground crew has to move equipment now.

| When | Interval |
|---|---|
| Airborne | 2 min |
| Within 30 min of departure | 1 min |
| Within 3 hours | 5 min |
| Within 24 hours | 30 min |
| Beyond | 6 hours |
| Arrived and settled, or cancelled | stop |

Following one flight from two days out through landing costs about 200 polls
against roughly 3,000 for a flat one-minute cadence, and it is no less current in
the window that matters. That is counted from the cadence function in
`poll-budget.spec.ts`, not asserted next to it.

It runs as **one repeating sweep**, not a chain of self-scheduling jobs. The
chain is the tempting shape and its failure mode only appears in production: a
job that exhausts its retries never books a successor, so that flight silently
stops being polled forever and the only symptom is a `lastSyncedAt` quietly
getting older. No error, no dead letter, nothing to page on.

---

## The operator UI

`web/` is a real client rather than a demo page, and three decisions in it are
worth stating because none of them are decoration.

**Every identifier is monospace.** Flight numbers, tail codes, ICAO airports and
times are fixed-width in every real aviation system, because that is what makes
a dense board scannable at a glance. The typeface carries the theme; there is no
ornament.

**An aircraft change is coloured warm, not red.** It is a routine event that
someone has to act on, not an emergency. Spend red on the routine case and there
is nothing left to say when something is genuinely wrong.

**Times render in UTC with the Z shown.** Aviation standardised on UTC precisely
so that nobody has to work out whose local time a number is in. Converting to
the viewer's zone would put that ambiguity straight back.

State is encoded in shape as well as colour — a border, a dot, a weight — so the
board still reads for anyone who cannot separate the hues.

The client talks to the service across origins with CORS, which is the shape it
would have in production anyway: the API and the operator UI are separately
deployed. `CORS_ORIGINS` controls who may connect.

---

## Providers

Default is `fixture`: it reports what the database holds, so a fresh clone runs
offline, free and deterministic. **This is not a shortcut.** Tail swaps are rare
— a given flight might see one every few weeks — so a system wired only to a
live API could not demonstrate the feature it exists for, could not be tested
deterministically, and would show a reviewer an empty screen while behaving
perfectly.

`FLIGHT_PROVIDER=fr24` switches to the real adapter. Its sandbox key is free and
consumes no credits.

### What was learned from the providers, first-hand

Both APIs were read in full and Flightradar24 was called live against its
sandbox. Some of it changed the design:

- **FR24 publishes no schedules.** "We do not provide flight scheduling
  information via our API." So `scheduledDeparture` is nullable and the
  schedule-relative tiers are unreachable for FR24-sourced flights; cadence
  falls back to status.
- **A flight does not exist in FR24's API until the aircraft is transmitting.**
  There is nothing to poll before departure. Flights are *discovered* by route,
  registration or area and then *followed* by the `fr24_id` that search
  returned — following by flight number would break at exactly the moment a
  flight number changes.
- **FR24 is inconsistent with itself about time zones.** `live/flight-positions`
  returns `2026-08-26T15:36:56Z`; `flight-summary` returns `2023-01-27T05:15:22`
  with no zone. JavaScript reads the second as local time — a silent three-hour
  shift here, in exactly the field used to decide whether a snapshot is newer
  than what we hold. The parser checks the *value*, since appending `Z`
  unconditionally would corrupt the other half.
- **Its OpenAPI document says `flight_ids` accepts 15; its prose documentation
  says 10.** The lower value is the default, and it is configurable rather than
  hard-coded. Note that FR24 bills per returned entity, so batching is a
  rate-limit control, not a cost control.
- **Anything 4xx other than 408 and 429 is permanent.** Every attempt is billed,
  so retrying a request that was wrong the first time spends money to learn
  nothing. FR24 documents 402, credit limit reached, on almost every endpoint.

FlightAware AeroAPI was evaluated and **not built**: no key, alerts are not on
the free tier, and its spec contains no signing mechanism at all, so the
delivery path could not have been verified. Implementing it from the document
would have turned verified research into a plausible guess.

---

## Testing

```bash
pnpm install
pnpm test                             # 129 unit tests, no database, ~3s

cp .env.example .env                  # migrate and seed read DATABASE_URL
docker compose up -d postgres redis
pnpm exec prisma migrate deploy       # once, to create the tables
pnpm test:e2e                         # 16 integration tests, real Postgres
```

`pnpm install` generates the Prisma client, so the unit tests run on a fresh
clone with nothing else set up.

Unit tests cover `src/domain` at 100% of lines, branches and functions today.
The gate in `package.json` sits at 100 for lines and functions and 95 for
branches — the slack is there so that adding a guard clause fails review rather
than the build.

Integration tests run against a real Postgres because everything they assert —
the compare-and-swap, `ON CONFLICT DO NOTHING`, the unique index, rollback — is
enforced by the database. Testing that against a fake would only test the fake.

Two of them are worth reading:

- **Five concurrent writers, five different values.** All five must land, with a
  gapless revision sequence. Asserting on identical concurrent values instead
  would pass even if four of the five were silently dropped.
- **The stale-while-retrying interaction.** Concurrent writes carrying
  increasing timestamps do *not* all land: whichever commits first raises the
  flight's watermark, and the ones still retrying then correctly drop themselves
  as stale. That behaviour is intended, and it is pinned so nobody later
  "fixes" it and breaks the ordering guard.

The change-detection tests earn their keep. Restoring the naive
`[A-Z0-9]{2,3}` in the flight-number regex turns 11 of them red.

The built-in dashboard is a string, so nothing type-checks it and nothing lints
it. That gap is real: the page once shipped with `String.raw`, which leaves the
escaping backslashes attached to the browser's own template literals and made
the emitted script a syntax error. `GET /` still answered 200 with a plausible
byte count, so every check short of opening it in a browser passed while the page
did nothing at all. Five tests now parse the emitted script rather than trusting
the status code.

---

## API

| | |
|---|---|
| `GET /` | Dashboard |
| `GET /flights` | Tracked flights with staleness |
| `GET /flights/:id/changes` | Change history |
| `GET /alerts` | Alerts, newest first |
| `POST /alerts/:id/ack` | Acknowledge |
| `GET /alerts/stream` | SSE |
| `POST /ingest/flight-snapshot` | Signed ingest |
| `POST /ingest/demo/tail-swap` | Local demo affordance — swaps the tail |
| `POST /ingest/demo/number-change` | Local demo affordance — renumbers a flight |

### Signed ingest

`X-Signature: t=<unix>,v1=<hex>` over the **raw** body, ±300s, constant-time
comparison. Deliberately Stripe's shape, because it is the same problem. Each
detail is load-bearing: middleware that parses JSON first has already changed
the bytes; a timestamp outside the signed payload lets a captured request stay
valid forever without the attacker needing the secret; and an early-returning
comparison leaks through timing how much of a guess was right.

---

## Assumptions

- Flight date is the **local departure date at the origin**, and goes to the
  wire as `YYYY-MM-DD`. Prisma has no date-only type, so serialising the column
  directly renders as the previous day for anyone west of UTC.
- ICAO codes, not IATA. Only ICAO is unique.
- Store as received, compare normalized. `nq-atc ` and `NQ-ATC` are one
  aircraft; `TK 0234` and `TK234` are one flight.
- A first observation is recorded in history but raises no alert. Learning a
  tail code is enrichment, not a change.
- An absent or null field means the provider said nothing, not that the value
  was cleared. A provider that stops reporting a tail number has not changed it.
- Ordering is by the provider's clock, never ours.
- One alert per change, enforced by the database.

## Known limitations

- **SSE is at-most-once.** It carries a nudge, not the payload; clients refetch
  on it and on reconnect, and a five-second poll keeps the screen correct if a
  push is missed. Fan-out is in-process, so more than one replica needs Redis
  pub/sub or sticky routing.
- **Ordering uses strict `<`.** Provider clocks have second resolution, so two
  snapshots in the same second can be applied in arrival order. Dropping a real
  change is worse than applying a redundant one, so equal timestamps pass.
- **No user authentication.** The brief defines no users, roles or tenancy, so
  JWT and RBAC would be scope theatre. Request authentication exists where it is
  real — the signed ingest boundary. In production the dashboard would sit
  behind Entra ID and alerts would be scoped per operator at the repository
  layer.
- **No cache.** Flight state is the freshest read in the system; caching it
  works against the product. The cacheable things are static reference data and
  provider usage figures.
- **Redis needs `noeviction`.** BullMQ requires it. Under memory pressure any
  other policy drops job locks, which surfaces as spurious stalled jobs and
  duplicate processing rather than as an obvious failure. Azure Cache defaults to
  `volatile-lru` and disables `CONFIG`, so it has to be set at provisioning.
- **Delayed job promotion needs a running worker**, so scaling the worker to
  zero freezes the queue permanently.
- **No circuit breaker at the provider boundary.** Failures are classified
  retryable or permanent, and that classification now drives the backoff — a
  permanent refusal waits an hour, a rate limit waits exactly as long as the
  provider asked. What is missing is the layer above: tripping the whole
  provider open after repeated failures and probing it back. The demo runs on
  fixture data, so its thresholds would have been tuned against nothing.

- **AeroAPI and Azure infrastructure-as-code are documented, not built.** See
  above for AeroAPI. Untested Bicep would assert things nobody had run.

## Next

A circuit breaker at the provider boundary, the week there is live traffic to
tune it against. The retryable/permanent split already exists to drive it.

Transactional outbox at the first side effect that cannot self-heal — a lost
SSE push is recovered by a refetch, a lost email is not. A reconciler sweep for
flights whose queue entry vanished with Redis. Deployment to Azure Container
Apps: one image, Key Vault and managed identity for secrets, OIDC federated
credentials for CI.

## Configuration

See `.env.example`. Every value there is fake. Numeric variables validate as
positive integers rather than plain coercion, because `z.coerce.number()` parses
an empty string to `0` and reports success — and an empty string is exactly what
an unedited `.env` or a blank platform secret produces. A timeout that silently
becomes zero is worse than one that is missing.
