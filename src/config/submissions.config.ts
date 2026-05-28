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
