import { registerAs } from '@nestjs/config';
import { config as loadEnvFile } from 'dotenv';
import { resolve } from 'path';

loadEnvFile({ path: resolve(process.cwd(), '.env') });

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

export const submissionDefaults = {
  maxContentLength: 10000,
  maxFileSizeMb: 10,
  maxFiles: 10,
  antiSpamWindowSeconds: 30,
  fileNameMaxLength: 500,
  fileMimetypeMaxLength: 255,
  driveFileIdMaxLength: 255,
  allowedMimeTypes: [
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
  ],
} as const;

export const getSubmissionSettingsFromEnv = () => ({
  maxContentLength: parseNumber(
    process.env.SUBMISSIONS_MAX_CONTENT_LENGTH,
    submissionDefaults.maxContentLength,
  ),
  maxFileSizeMb: parseNumber(
    process.env.SUBMISSIONS_MAX_FILE_SIZE_MB,
    submissionDefaults.maxFileSizeMb,
  ),
  maxFiles: parseNumber(
    process.env.SUBMISSIONS_MAX_FILES,
    submissionDefaults.maxFiles,
  ),
  antiSpamWindowSeconds: parseNumber(
    process.env.SUBMISSIONS_ANTI_SPAM_WINDOW_SECONDS,
    submissionDefaults.antiSpamWindowSeconds,
  ),
  fileNameMaxLength: parseNumber(
    process.env.SUBMISSIONS_FILE_NAME_MAX_LENGTH,
    submissionDefaults.fileNameMaxLength,
  ),
  fileMimetypeMaxLength: parseNumber(
    process.env.SUBMISSIONS_FILE_MIMETYPE_MAX_LENGTH,
    submissionDefaults.fileMimetypeMaxLength,
  ),
  driveFileIdMaxLength: parseNumber(
    process.env.SUBMISSIONS_DRIVE_FILE_ID_MAX_LENGTH,
    submissionDefaults.driveFileIdMaxLength,
  ),
  allowedMimeTypes: parseList(
    process.env.SUBMISSIONS_ALLOWED_MIME_TYPES,
    [...submissionDefaults.allowedMimeTypes],
  ),
  driveEnabled: process.env.DRIVE_UPLOAD_ENABLED === 'true',
  driveOauthClientId: process.env.DRIVE_OAUTH_CLIENT_ID,
  driveOauthClientSecret: process.env.DRIVE_OAUTH_CLIENT_SECRET,
  driveOauthRefreshToken: process.env.DRIVE_OAUTH_REFRESH_TOKEN,
  driveFolderId: process.env.DRIVE_FOLDER_ID,
});

export default registerAs('submissions', () => getSubmissionSettingsFromEnv());
