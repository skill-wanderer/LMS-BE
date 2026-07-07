import { registerAs } from '@nestjs/config';
import { config as loadEnvFile } from 'dotenv';
import { resolve } from 'path';

loadEnvFile({ path: resolve(process.cwd(), '.env') });

const parseNumber = (value: string | undefined, defaultValue: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

export const userDefaults = {
  idMaxLength: 36,
  usernameMaxLength: 255,
  emailMaxLength: 255,
  firstNameMaxLength: 255,
  lastNameMaxLength: 255,
  actionNameMaxLength: 255,
} as const;

export const getUserSettingsFromEnv = () => ({
  idMaxLength: parseNumber(process.env.USERS_ID_MAX_LENGTH, userDefaults.idMaxLength),
  usernameMaxLength: parseNumber(
    process.env.USERS_USERNAME_MAX_LENGTH,
    userDefaults.usernameMaxLength,
  ),
  emailMaxLength: parseNumber(
    process.env.USERS_EMAIL_MAX_LENGTH,
    userDefaults.emailMaxLength,
  ),
  firstNameMaxLength: parseNumber(
    process.env.USERS_FIRST_NAME_MAX_LENGTH,
    userDefaults.firstNameMaxLength,
  ),
  lastNameMaxLength: parseNumber(
    process.env.USERS_LAST_NAME_MAX_LENGTH,
    userDefaults.lastNameMaxLength,
  ),
  actionNameMaxLength: parseNumber(
    process.env.USERS_ACTION_NAME_MAX_LENGTH,
    userDefaults.actionNameMaxLength,
  ),
});

export default registerAs('users', () => getUserSettingsFromEnv());
