# Spec 0001 — User JIT Provisioning and Activity Tracking

| | |
|---|---|
| **Status** | Draft |
| **Author** | Codex |
| **Created** | 2026-07-06 |
| **Published** | 2026-07-06 |
| **Feature area** | `auth` domain — Keycloak-backed user sync + activity tracking |

---

## 1. Summary

Add a local `users` table to the LMS backend and synchronize it from validated
Keycloak access tokens during authenticated requests.

The backend already validates Keycloak JWTs and maps claims into an in-memory
authenticated user object, but it does **not** currently persist those users in
PostgreSQL. This spec adds:

- a physical `users` table in PostgreSQL
- **JIT provisioning** on first authenticated request
- **profile synchronization** on later requests
- **activity tracking** via `last_activity_at` and `last_action_name`
- a concurrency-safe **UPSERT**-based implementation integrated into the
  existing NestJS auth flow
- a required **parallel execution split** between:
  - the **Main Thread**, which authenticates and guarantees the user row exists
  - the **Worker Thread**, which records engagement metrics after provisioning

---

## 2. Goals

- Define a `users` table that mirrors the core identity fields from Keycloak.
- Use Keycloak `sub` as the stable user primary key in LMS.
- Provision a local user row automatically on the first successful
  authenticated request.
- Keep `username`, `email`, `first_name`, and `last_name` synchronized from the
  latest token on later requests.
- Update `updated_at` only when core profile fields actually change.
- Track the user's latest backend activity via `last_activity_at` and
  `last_action_name`.
- Integrate this into the current Keycloak authentication path without changing
  the public API contract.
- Enforce a **parallel main-thread / worker-thread model** for provisioning vs
  activity tracking.

## 3. Non-Goals

- No user registration UI.
- No local password auth.
- No local persistence of Keycloak roles.
- No admin CRUD endpoints for users.
- No synchronization of extra Keycloak claims beyond the fields defined here.
- No audit/event history table in this iteration; only the latest activity
  snapshot is stored.
- No redesign of the existing auth strategy away from Keycloak JWT validation.

---

## 4. Decisions (resolved)

| Topic | Decision |
|---|---|
| **Identity source** | Keycloak remains the source of truth for identity. The LMS only mirrors selected claims. |
| **Primary key** | `users.id = token.sub` directly. No separate surrogate user ID. |
| **Provisioning model** | JIT provisioning on authenticated requests. |
| **Sync strategy** | Atomic PostgreSQL `INSERT ... ON CONFLICT (id) DO UPDATE`. |
| **Profile update trigger** | `updated_at` changes only when `username`, `email`, `first_name`, or `last_name` changes. |
| **Activity tracking** | `last_activity_at` and `last_action_name` are updated only after provisioning is guaranteed, and must execute in a parallel worker thread/task. |
| **Action source** | Initial implementation uses request context, preferably `METHOD + route path`. |
| **Failure behavior** | Provisioning failure fails the request; worker-thread activity logging failure is logged and must not fail the business request. |
| **Concurrency model** | Database-level UPSERT is the identity concurrency boundary; worker-thread activity tracking runs after provisioning and in parallel with the main request path. |
| **Parallelism requirement** | Step 3 and Step 4 are intentionally separated: Main Thread performs identity provisioning; Worker Thread performs engagement tracking. This is a required design constraint, not an implementation detail. |

---

## 5. Current State

The feature is **not implemented** in the current codebase.

What already exists:

- Keycloak JWT validation in
  [src/auth/strategies/keycloak.strategy.ts](/D:/Skill-Wanderer/LMS-BE/src/auth/strategies/keycloak.strategy.ts:52)
- global auth enforcement in
  [src/auth/guards/keycloak-auth.guard.ts](/D:/Skill-Wanderer/LMS-BE/src/auth/guards/keycloak-auth.guard.ts:17)
- TypeORM/PostgreSQL integration in
  [src/database/database.module.ts](/D:/Skill-Wanderer/LMS-BE/src/database/database.module.ts:6)

What is missing:

- local `users` entity and module
- auth-time database UPSERT for users
- a true main-thread / worker-thread activity tracking split
- activity update for `last_activity_at`
- activity update for `last_action_name`

---

## 6. Data Model

### 6.1 `users` table

| Column Name | Data Type | Constraints | Description |
|---|---|---|---|
| `id` | `varchar(36)` | `PRIMARY KEY`, `NOT NULL` | Unique user identifier. Matches Keycloak `sub`. |
| `username` | `varchar(255)` | `UNIQUE`, `NOT NULL` | Username from `preferred_username`. |
| `email` | `varchar(255)` | `NOT NULL` | Primary email address. |
| `first_name` | `varchar(255)` | nullable | Given name from `given_name`. |
| `last_name` | `varchar(255)` | nullable | Family name from `family_name`. |
| `last_activity_at` | `timestamp` | nullable | Latest recorded LMS interaction time. |
| `last_action_name` | `varchar(255)` | nullable | Latest recorded action code or route descriptor. |
| `created_at` | `timestamp` | `NOT NULL`, default `CURRENT_TIMESTAMP` | Row creation time. |
| `updated_at` | `timestamp` | `NOT NULL`, default `CURRENT_TIMESTAMP` | Last core profile update time. |

### 6.2 TypeORM entity

Add a `User` entity in `src/users/entities/user.entity.ts` with explicit
snake_case column names:

- `id`
- `username`
- `email`
- `firstName` → `first_name`
- `lastName` → `last_name`
- `lastActivityAt` → `last_activity_at`
- `lastActionName` → `last_action_name`
- `createdAt` → `created_at`
- `updatedAt` → `updated_at`

### 6.3 Suggested PostgreSQL DDL

```sql
CREATE TABLE users (
    id               varchar(36)  PRIMARY KEY,
    username         varchar(255) NOT NULL UNIQUE,
    email            varchar(255) NOT NULL,
    first_name       varchar(255) NULL,
    last_name        varchar(255) NULL,
    last_activity_at timestamp    NULL,
    last_action_name varchar(255) NULL,
    created_at       timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## 7. Keycloak Claim Mapping

### 7.1 Token to database mapping

| Token Claim / System Source | Target Column | Logic |
|---|---|---|
| `token.payload.sub` | `id` | Primary lookup key and user identity key. |
| `token.payload.preferred_username` | `username` | Insert/update from token. |
| `token.payload.email` | `email` | Insert/update from token. |
| `token.payload.given_name` | `first_name` | Insert/update from token. |
| `token.payload.family_name` | `last_name` | Insert/update from token. |
| current system time | `last_activity_at` | Updated by the Worker Thread after provisioning succeeds. |
| route or action context | `last_action_name` | Updated by the Worker Thread after provisioning succeeds. |
| current system time | `updated_at` | Updated only when profile fields changed. |

### 7.2 Required claims

Required for provisioning:

- `sub`
- `preferred_username`
- `email`

Optional:

- `given_name`
- `family_name`

If optional claims are absent, store `NULL` in the local database.

---

## 8. Request Flow

### 8.1 Step 1: Token acquisition

The frontend authenticates with Keycloak and receives an access token.

The token is attached to backend requests through:

```http
Authorization: Bearer <access_token>
```

### 8.2 Step 2: Middleware interception (Main Thread)

The backend auth middleware/guard on the main request path:

1. validates the JWT signature
2. validates issuer and token properties
3. decodes the payload
4. extracts:
   - `sub`
   - `preferred_username`
   - `email`
   - `given_name`
   - `family_name`
5. maps the token to an `AuthenticatedUser`

### 8.3 Step 3: Atomic JIT provisioning (Main Thread)

After authentication succeeds, the Main Thread must run a single atomic UPSERT
into `users` before the request is allowed to continue to business logic.

Behavior:

- if `id` does not exist, insert a new row
- if `id` already exists, update local profile fields from the latest token
- update `updated_at` only if one or more mapped profile fields changed
- do **not** rely on application-side read-then-write logic
- let PostgreSQL own the concurrency boundary

Recommended SQL:

```sql
INSERT INTO users (
  id,
  username,
  email,
  first_name,
  last_name,
  created_at,
  updated_at
)
VALUES (
  :id,
  :username,
  :email,
  :firstName,
  :lastName,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO UPDATE
SET
  username = EXCLUDED.username,
  email = EXCLUDED.email,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  updated_at = CASE
    WHEN users.username IS DISTINCT FROM EXCLUDED.username
      OR users.email IS DISTINCT FROM EXCLUDED.email
      OR users.first_name IS DISTINCT FROM EXCLUDED.first_name
      OR users.last_name IS DISTINCT FROM EXCLUDED.last_name
    THEN CURRENT_TIMESTAMP
    ELSE users.updated_at
  END;
```

### 8.4 Step 4: Parallel activity tracking (Worker Thread)

Once Step 3 completes successfully, the Main Thread:

1. passes the request down to the business controller/service
2. concurrently spins up or notifies a Worker Thread / parallel background task
   dedicated to engagement tracking

The Worker Thread must execute only after provisioning is guaranteed, and then
perform:

```sql
UPDATE users
SET
  last_activity_at = CURRENT_TIMESTAMP,
  last_action_name = :actionName
WHERE id = :id;
```

Rules:

- Step 4 must not begin before Step 3 succeeds.
- The Worker Thread must update only an already-existing `users` row.
- Activity logging must not block the business response once the Worker Thread
  has been dispatched.
- Worker-thread failure must be logged and must not roll back the main request.
- This is a required **parallel** design: provisioning stays on the Main
  Thread, engagement tracking moves to a Worker Thread / parallel task.

---

## 9. NestJS Design

### 9.1 New module layout

```text
src/
├── users/
│   ├── entities/
│   │   └── user.entity.ts
│   ├── users.module.ts
│   └── users.service.ts
```

### 9.2 Service responsibilities

`UsersService` should expose:

- `upsertFromKeycloakUser(user: AuthenticatedUser): Promise<void>`
- `recordActivity(userId: string, actionName: string): Promise<void>`

### 9.3 Required execution split

The implementation must explicitly separate responsibilities:

- **Main Thread**
  - validate JWT
  - map token claims
  - run the atomic UPSERT
  - release the request to the target controller/service

- **Worker Thread / Parallel Task**
  - receive `userId`
  - receive resolved `actionName`
  - update `last_activity_at`
  - update `last_action_name`

This separation is mandatory because Step 4 is not just "another async call" in
the same conceptual flow; it is a dedicated parallel activity-tracking path that
depends on Step 3 having already completed.

### 9.4 Integration point

Recommended integration for the current codebase:

1. keep `KeycloakStrategy.validate()` responsible only for token-to-user
   mapping
2. keep authentication interception on the existing auth middleware/guard path
3. perform `upsertFromKeycloakUser(...)` on the Main Thread
4. dispatch `recordActivity(...)` to a Worker Thread / parallel task only after
   Main Thread provisioning succeeds
5. let the request continue to the business controller without waiting for the
   activity update result

Preferred place:

- extend the existing global auth path in
  `KeycloakAuthGuard`, or
- add an auth-aware middleware/interceptor immediately after successful
  authentication

Important constraint:

- if the current implementation framework does not use a literal Node
  `worker_threads` object, the design must still preserve the same architectural
  contract:
  - Main Thread guarantees the row exists
  - Worker Thread / parallel task updates engagement metrics independently
  - main business flow must not wait for the activity update to finish

Guard-based interception is still acceptable for the Main Thread side because
the project already has a single global Keycloak guard, but Step 4 must remain
an explicitly parallel background execution path.

### 9.5 Route-to-action mapping

Initial implementation:

- `GET /auth/profile`
- `POST /courses/:courseSlug/lessons/:lessonSlug/complete`
- `POST /lessons/:lessonId/submissions`

Stored as `METHOD + route path` or equivalent normalized route descriptor.

Future enhancement:

- replace route descriptors with business codes like `VIEW_COURSE`,
  `COMPLETE_LESSON`, `SUBMIT_ASSIGNMENT`

---

## 10. Error Handling

| Situation | HTTP | Behavior |
|---|---|---|
| Invalid or missing JWT | `401` | Same behavior as current auth flow. |
| User UPSERT fails | `500` | Fail the request because identity provisioning is part of auth success handling. |
| Worker-thread activity update fails | `200`/normal route status | Log the failure, but do not fail the business request. |

---

## 11. Security Considerations

- Keycloak remains the source of truth; local data is only a projection.
- The backend must never trust client-supplied identity fields outside the
  validated token.
- User provisioning must happen only after successful JWT validation.
- UPSERT must be race-safe for concurrent first-time requests from the same
  Keycloak identity.
- Activity updates must target only an already-provisioned user row.
- The Worker Thread must not be able to create or provision a user implicitly;
  it only updates engagement fields on an existing row.

---

## 12. Open Questions

| ID | Question | Spec assumption |
|---|---|---|
| OQ-1 | Should `username` remain globally unique in LMS? | Yes |
| OQ-2 | Should missing `email` block provisioning, or should empty string fallback be allowed? | Block unless project decides otherwise |
| OQ-3 | Should `last_action_name` store route descriptors or business action codes? | Route descriptors first |
| OQ-4 | Is the Worker Thread implemented with literal `worker_threads`, a queue worker, or another parallel task abstraction? | Open; any choice is acceptable only if Step 4 remains a real parallel path separated from Main Thread provisioning |

---

## 13. Migration / Impact on Existing Code

- Add a new `users` module to the NestJS app.
- Add a new `User` entity so TypeORM can create/manage the `users` table.
- Wire provisioning into the global authenticated request lifecycle.
- Add a worker-thread / parallel-task path for engagement tracking.
- No public API endpoint changes are required for this spec.
- Existing controllers/services continue to consume the authenticated user as
  before.

---

## 14. Acceptance Criteria

- [ ] A `users` table exists in PostgreSQL with the columns defined in §6.1.
- [ ] A first authenticated request from a Keycloak user inserts a local row.
- [ ] Repeated authenticated requests for the same `sub` do not create
      duplicates.
- [ ] If `preferred_username`, `email`, `given_name`, or `family_name` changes
      in Keycloak, the next valid request synchronizes the LMS row.
- [ ] `updated_at` changes only when synchronized profile fields changed.
- [ ] `last_activity_at` updates after successful authentication.
- [ ] `last_action_name` records the route or mapped action context.
- [ ] Concurrent first-time requests for the same `sub` are handled safely via
      UPSERT.
- [ ] If provisioning fails, the request fails.
- [ ] Step 3 runs on the Main Thread and guarantees the row exists before the
      request proceeds.
- [ ] Step 4 runs on a Worker Thread / parallel background task after Step 3
      succeeds.
- [ ] The business request is not blocked waiting for Step 4 to complete.
- [ ] If activity logging fails, the main business request still succeeds.

---

## 15. Future Specs

1. Add user listing/admin inspection endpoints if product requirements need them.
2. Replace route-based `last_action_name` with standardized business action
   codes.
3. Add audit/event history tables if full user activity history is required.
4. Add test coverage for concurrent auth requests, worker-thread dispatch, and
   profile-change sync.
