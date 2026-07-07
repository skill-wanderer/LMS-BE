import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/interfaces/keycloak-token.interface';
import { User } from './entities/user.entity';
import { userDefaults } from '../config/users.config';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly limits: {
    idMaxLength: number;
    usernameMaxLength: number;
    emailMaxLength: number;
    firstNameMaxLength: number;
    lastNameMaxLength: number;
    actionNameMaxLength: number;
  };

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    this.limits = {
      idMaxLength: this.configService.get<number>(
        'users.idMaxLength',
        userDefaults.idMaxLength,
      ),
      usernameMaxLength: this.configService.get<number>(
        'users.usernameMaxLength',
        userDefaults.usernameMaxLength,
      ),
      emailMaxLength: this.configService.get<number>(
        'users.emailMaxLength',
        userDefaults.emailMaxLength,
      ),
      firstNameMaxLength: this.configService.get<number>(
        'users.firstNameMaxLength',
        userDefaults.firstNameMaxLength,
      ),
      lastNameMaxLength: this.configService.get<number>(
        'users.lastNameMaxLength',
        userDefaults.lastNameMaxLength,
      ),
      actionNameMaxLength: this.configService.get<number>(
        'users.actionNameMaxLength',
        userDefaults.actionNameMaxLength,
      ),
    };
  }

  async upsertFromKeycloakUser(user: AuthenticatedUser): Promise<void> {
    const normalizedUser = {
      id: this.requireNonEmpty(user.id, 'id', user.id, this.limits.idMaxLength),
      username: this.requireNonEmpty(
        user.username,
        'username',
        user.id,
        this.limits.usernameMaxLength,
      ),
      email: this.requireNonEmpty(user.email, 'email', user.id, this.limits.emailMaxLength),
      firstName: this.normalizeNullable(user.firstName, this.limits.firstNameMaxLength),
      lastName: this.normalizeNullable(user.lastName, this.limits.lastNameMaxLength),
    };

    await this.userRepo.query(
      `
        INSERT INTO users (
          id,
          username,
          email,
          first_name,
          last_name,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
          END
      `,
      [
        normalizedUser.id,
        normalizedUser.username,
        normalizedUser.email,
        normalizedUser.firstName,
        normalizedUser.lastName,
      ],
    );
  }

  async recordActivity(userId: string, actionName: string): Promise<void> {
    await this.userRepo.query(
      `
        UPDATE users
        SET
          last_activity_at = CURRENT_TIMESTAMP,
          last_action_name = $2
        WHERE id = $1
      `,
      [userId, this.normalizeNullable(actionName)],
    );
  }

  private requireNonEmpty(
    value: string | undefined,
    fieldName: string,
    userId: string,
    maxLength: number,
  ): string {
    const normalized = value?.trim();

    if (!normalized) {
      throw new Error(
        `Cannot provision user ${userId}: token is missing required field "${fieldName}"`,
      );
    }

    return normalized.slice(0, maxLength);
  }

  private normalizeNullable(
    value: string | undefined | null,
    maxLength = this.limits.actionNameMaxLength,
  ): string | null {
    const normalized = value?.trim();
    return normalized ? normalized.slice(0, maxLength) : null;
  }
}
