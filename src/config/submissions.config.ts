import { registerAs } from '@nestjs/config';

const parseNumber = (value: string | undefined, defaultValue: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const parseList = (value: string | undefined, defaultValue: string[]): string[] => {
  if (!value) {
    return defaultValue;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export default registerAs('submissions', () => ({
  maxFileSizeMb: parseNumber(process.env.SUBMISSIONS_MAX_FILE_SIZE_MB, 10),
  maxFiles: parseNumber(process.env.SUBMISSIONS_MAX_FILES, 10),
  antiSpamWindowSeconds: parseNumber(process.env.SUBMISSIONS_ANTI_SPAM_WINDOW_SECONDS, 30),
  retentionDays: parseNumber(process.env.SUBMISSIONS_RETENTION_DAYS, 30),
  archivedPurgeDays: parseNumber(process.env.SUBMISSIONS_ARCHIVED_PURGE_DAYS, 0),
  cleanupBatchSize: parseNumber(process.env.SUBMISSIONS_CLEANUP_BATCH_SIZE, 100),
  orphanScanBatchSize: parseNumber(process.env.SUBMISSIONS_ORPHAN_SCAN_BATCH_SIZE, 100),
  cleanupSchedule: process.env.SUBMISSIONS_CLEANUP_SCHEDULE || '*/5 * * * *',
  orphanScanSchedule: process.env.SUBMISSIONS_ORPHAN_SCAN_SCHEDULE || '*/10 * * * *',
  serverTimezone: process.env.SUBMISSIONS_SERVER_TIMEZONE || process.env.SERVER_TIMEZONE || 'UTC',
  systemActorId:
    process.env.SUBMISSIONS_SYSTEM_ACTOR_ID ||
    '00000000-0000-0000-0000-000000000000',
  allowedMimeTypes: parseList(process.env.SUBMISSIONS_ALLOWED_MIME_TYPES, [
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
  ]),
  driveEnabled: process.env.DRIVE_UPLOAD_ENABLED === 'true',
  driveOauthClientId: process.env.DRIVE_OAUTH_CLIENT_ID,
  driveOauthClientSecret: process.env.DRIVE_OAUTH_CLIENT_SECRET,
  driveOauthRefreshToken: process.env.DRIVE_OAUTH_REFRESH_TOKEN,
  driveFolderId: process.env.DRIVE_FOLDER_ID,
}));
