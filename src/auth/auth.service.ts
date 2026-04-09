import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from './interfaces/keycloak-token.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Returns the authenticated user's profile from the JWT token.
   */
  getProfile(user: AuthenticatedUser) {
    this.logger.debug(`Fetching profile for user: ${user.id}`);

    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      name: user.name,
      roles: user.roles,
    };
  }
}
