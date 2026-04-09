import {
  Injectable,
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Observable } from 'rxjs';
import { AuthenticatedUser } from '../interfaces/keycloak-token.interface';

/**
 * Global auth guard that validates Keycloak JWT tokens.
 * Routes decorated with @Public() bypass authentication.
 */
@Injectable()
export class KeycloakAuthGuard extends AuthGuard('keycloak') {
  private readonly logger = new Logger(KeycloakAuthGuard.name);
  private hasLoggedBypassWarning = false;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const bypassEnabled =
      this.configService.get<string>('AUTH_BYPASS', 'false') === 'true';

    if (bypassEnabled) {
      const request = context.switchToHttp().getRequest();
      request.user = this.createBypassUser();

      if (!this.hasLoggedBypassWarning) {
        this.logger.warn(
          'AUTH_BYPASS is enabled. All authenticated routes will accept a local bypass user. Disable this in non-local environments.',
        );
        this.hasLoggedBypassWarning = true;
      }

      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      const request = context.switchToHttp().getRequest();
      const authHeader = request?.headers?.authorization as string | undefined;

      this.logger.error('Authentication failed', {
        method: request?.method,
        path: request?.originalUrl ?? request?.url,
        hasAuthorizationHeader: Boolean(authHeader),
        authorizationScheme: authHeader?.split(' ')[0] ?? null,
        error: this.formatAuthError(err),
        info: this.formatAuthError(info),
      });

      throw err instanceof UnauthorizedException
        ? err
        : new UnauthorizedException('Unauthorized');
    }

    return user;
  }

  private formatAuthError(value: unknown): unknown {
    if (!value) {
      return null;
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    if (typeof value === 'object') {
      return value;
    }

    return String(value);
  }

  private createBypassUser(): AuthenticatedUser {
    const userId = this.configService.get<string>(
      'AUTH_BYPASS_USER_ID',
      'local-learner-id',
    );
    const email = this.configService.get<string>(
      'AUTH_BYPASS_EMAIL',
      'local.learner@skill-wanderer.local',
    );
    const username = this.configService.get<string>(
      'AUTH_BYPASS_USERNAME',
      'local-learner',
    );

    return {
      id: userId,
      email,
      emailVerified: true,
      username,
      firstName: 'Local',
      lastName: 'Learner',
      name: 'Local Learner',
      roles: ['learner', 'admin'],
      realmRoles: ['learner', 'admin'],
      clientRoles: [],
      tokenPayload: {
        sub: userId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'local-auth-bypass',
        aud: 'lms-be',
        azp: 'lms-be',
        preferred_username: username,
        email,
        email_verified: true,
        realm_access: {
          roles: ['learner', 'admin'],
        },
      },
    };
  }
}
