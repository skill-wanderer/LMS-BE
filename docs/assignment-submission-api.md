# Assignment Submission API

API endpoints for creating assignment submissions, checking the current submission state, and updating grading status.

All endpoints require a valid Keycloak JWT access token in the `Authorization` header.

```
Authorization: Bearer <access_token>
```

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/lessons/{lessonId}/submissions` | Submit assignment by lesson ID |
| `POST` | `/api/courses/{courseSlug}/lessons/{lessonSlug}/submissions` | Submit assignment by course slug and lesson slug |
| `GET` | `/api/courses/{courseSlug}/lessons/{lessonSlug}/submissions/state` | Get current submission state for the authenticated learner |
| `PATCH` | `/api/submissions/{submissionId}/status` | Update a submission status in the grading workflow |

---

## Submit Assignment By Lesson ID

```
POST /api/lessons/{lessonId}/submissions
```

Creates a new submission for the authenticated learner using a lesson UUID.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `lessonId` | string (UUID) | Lesson identifier |

### Request Content Type

`multipart/form-data`

### Request Body

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `contentText` | string | no | Trimmed, max length 10000 |
| `fileCount` | integer | no | 0-10, must equal uploaded file count when provided |
| `files` | binary[] | no | Max 10 files |

At least one of `contentText` or `files` must be provided.

### Success Response

**`201 Created`**

```json
{
  "submissionId": "96ca26c3-d92c-474e-98e3-f5fbf23e7ae7",
  "lessonId": "a54fdb6f-a2cf-4c78-8266-d3bf25d0f1aa",
  "userId": "00000000-0000-0000-0000-000000000001",
  "status": "WAITING",
  "version": 1,
  "contentText": "My assignment answer.",
  "createdAt": "2026-04-08T09:00:00.000Z",
  "updatedAt": "2026-04-08T09:00:00.000Z",
  "files": [
    {
      "id": "c6e8278e-8f5c-4942-a218-4d9e45fc3145",
      "fileName": "answer.pdf",
      "fileMimetype": "application/pdf",
      "driveFileId": "1hFp_v4cUJIEdwvE5dDqWcWFV0Xmr-IfQ",
      "driveUrl": "https://drive.google.com/file/d/1hFp_v4cUJIEdwvE5dDqWcWFV0Xmr-IfQ/view",
      "createdAt": "2026-04-08T09:00:00.000Z"
    }
  ]
}
```

### Error Responses

**`400 Bad Request`**

```json
{
  "statusCode": 400,
  "message": "Either contentText or files must be provided"
}
```

```json
{
  "statusCode": 400,
  "message": "fileCount mismatch: expected 2, received 1"
}
```

**`403 Forbidden`**

```json
{
  "statusCode": 403,
  "message": "Resubmission is prohibited after the lesson is passed"
}
```

**`404 Not Found`**

```json
{
  "statusCode": 404,
  "message": "Lesson not found"
}
```

**`413 Payload Too Large`**

```json
{
  "statusCode": 413,
  "message": "File answer.pdf exceeds 10MB"
}
```

**`415 Unsupported Media Type`**

```json
{
  "statusCode": 415,
  "message": "File malware.exe has unsupported MIME type application/x-msdownload"
}
```

**`429 Too Many Requests`**

```json
{
  "statusCode": 429,
  "message": "This submission is being graded and cannot be resubmitted yet"
}
```

---

## Submit Assignment By Slugs

```
POST /api/courses/{courseSlug}/lessons/{lessonSlug}/submissions
```

Creates a new submission using frontend-friendly slugs instead of a lesson UUID.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `courseSlug` | string | Course slug |
| `lessonSlug` | string | Lesson slug |

### Request Body

The request body and responses are the same as the lesson ID endpoint above.

### Notes

- The course and lesson pair must already exist.
- Missing or whitespace-only slugs return `404 Not Found`.

---

## Get Submission State

```
GET /api/courses/{courseSlug}/lessons/{lessonSlug}/submissions/state
```

Returns the current submission workflow state for the authenticated learner.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `courseSlug` | string | Course slug |
| `lessonSlug` | string | Lesson slug |

### Success Response

**`200 OK`**

If the learner has never submitted:

```json
{
  "status": "ACTIVE",
  "canSubmit": true,
  "latestSubmission": null
}
```

If a submission exists:

```json
{
  "status": "WAITING",
  "canSubmit": false,
  "latestSubmission": {
    "submissionId": "96ca26c3-d92c-474e-98e3-f5fbf23e7ae7",
    "lessonId": "a54fdb6f-a2cf-4c78-8266-d3bf25d0f1aa",
    "userId": "00000000-0000-0000-0000-000000000001",
    "status": "WAITING",
    "version": 2,
    "contentText": "Updated answer",
    "createdAt": "2026-04-08T10:00:00.000Z",
    "updatedAt": "2026-04-08T10:00:00.000Z",
    "files": []
  }
}
```

### State Meanings

| State | Meaning | Can Submit |
|-------|---------|------------|
| `ACTIVE` | No submission exists yet, or the latest state does not block a new submission | `true` |
| `WAITING` | A submitted assignment is waiting for review | `true` |
| `GRADING` | The submission is currently being graded | `false` |
| `PASS` | The learner has passed this assignment | `false` |
| `FAIL` | The latest reviewed submission failed | `true` |

---

## Update Submission Status

```
PATCH /api/submissions/{submissionId}/status
```

Updates a submission status for grading workflow. This endpoint is intended for admin users.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `submissionId` | string (UUID) | Submission identifier |

### Request Body

```json
{
  "status": "GRADING"
}
```

Allowed request values:

- `GRADING`
- `PASS`
- `FAIL`

### Allowed Status Transitions

| Current Status | Allowed Next Status |
|----------------|---------------------|
| `WAITING` | `GRADING`, `PASS`, `FAIL` |
| `GRADING` | `PASS`, `FAIL` |
| `PASS` | none |
| `FAIL` | none |
| `SUPERSEDED` | none |
| `FILE_LOST` | none |
| `ARCHIVED` | none |

### Success Response

**`200 OK`**

Returns the updated submission in the same shape as the submit response.

### Error Responses

**`400 Bad Request`**

```json
{
  "statusCode": 400,
  "message": "Cannot change submission status from PASS to FAIL"
}
```

**`404 Not Found`**

```json
{
  "statusCode": 404,
  "message": "Submission not found"
}
```

---

## Validation And Workflow Rules

- The request must be authenticated.
- Submission endpoints require the `learner` role.
- Status update endpoint requires the `admin` role.
- `fileCount` must match the number of uploaded files when provided.
- The backend validates MIME type against `SUBMISSIONS_ALLOWED_MIME_TYPES`.
- The backend validates file size against `SUBMISSIONS_MAX_FILE_SIZE_MB`.
- Filenames are sanitized before upload.
- A learner cannot resubmit within `SUBMISSIONS_ANTI_SPAM_WINDOW_SECONDS` from the last submission.
- A learner cannot submit while a `PENDING` row exists for the same lesson and user.
- A learner cannot resubmit while a `GRADING` submission exists.
- A learner cannot resubmit after a `PASS` submission exists.
- Previous non-passed submissions for the same lesson are marked `SUPERSEDED` when a new submission is accepted.

---

## Storage And Data Model

### Tables

- Parent table: `submissions`
- Child table: `submission_files`

### Partial Unique Index

```sql
CREATE UNIQUE INDEX idx_pending_sub
ON submissions (user_id, lesson_id)
WHERE (status = 'PENDING');
```

### Submission Status Values

 - `PENDING`
- `WAITING`
- `GRADING`
- `PASS`
- `FAIL`
- `SUPERSEDED`
- `FILE_LOST`
- `ARCHIVED`

### Transaction Flow

1. Start a database transaction.
2. Mark previous non-passed submissions for the same learner and lesson as `SUPERSEDED`.
3. Compute the next submission version.
4. Insert the parent submission row with `status = PENDING`.
5. Upload files to Google Drive.
6. Insert one child row per uploaded file into `submission_files`.
7. Verify saved file count integrity.
8. Transition the parent row to `WAITING` before commit.
9. Commit on success.
10. Roll back and delete uploaded Drive files if synchronization fails.

---

## Maintenance Jobs

### Superseded Cleanup Job

- Schedule: `SUBMISSIONS_CLEANUP_SCHEDULE`
- Timezone: `SUBMISSIONS_SERVER_TIMEZONE` (fallback: `SERVER_TIMEZONE`)
- Archives old `SUPERSEDED` records based on `SUBMISSIONS_RETENTION_DAYS`
- Deletes associated Google Drive files before archive finalization
- Clears `driveFileId` and `driveUrl` in `submission_files` for audit retention
- Purges archived rows when `SUBMISSIONS_ARCHIVED_PURGE_DAYS` is greater than `0`

### Orphan Drive Scan Job

- Schedule: `SUBMISSIONS_ORPHAN_SCAN_SCHEDULE`
- Scans Google Drive files using `appProperties.submission_id`
- Deletes Drive files whose referenced submission no longer exists in the database

---

## Implementation Notes

- Controller: `src/assignments/assignments.controller.ts`
- Service: `src/assignments/assignments.service.ts`
- Response DTO: `src/assignments/dto/assignment-submission-response.dto.ts`
- Swagger documentation is auto-generated at `/api/docs`
- The slug-based submit endpoint is the most FE-friendly endpoint for regular product use
