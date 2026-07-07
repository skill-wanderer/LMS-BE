import {
  Injectable,
  ExecutionContext,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { UsersService } from '../../users/users.service';
import { AuthenticatedUser } from '../interfaces/keycloak-token.interface';
import { UserActivityWorkerService } from '../../users/user-activity-worker.service';

/**
 * Global auth guard that validates Keycloak JWT tokens.
 * Routes decorated with @Public() bypass authentication.
 */
@Injectable()
export class KeycloakAuthGuard extends AuthGuard('keycloak') {
  private readonly logger = new Logger(KeycloakAuthGuard.name);

  constructor(
    private reflector: Reflector,
    private readonly usersService: UsersService,
    private readonly userActivityWorkerService: UserActivityWorkerService,
  ) {
    super();
  }

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const activationResult = super.canActivate(context);
    const authenticated = isObservable(activationResult)
      ? await firstValueFrom(activationResult)
      : await activationResult;

    if (!authenticated) {
      return false;
    }

    const request = context.switchToHttp().getRequest();
    const user = request?.user as AuthenticatedUser | undefined;

    if (!user) {
      this.logger.error('Authentication succeeded but request.user is missing');
      throw new InternalServerErrorException(
        'Authenticated user context is unavailable',
      );
    }

    await this.usersService.upsertFromKeycloakUser(user);
    this.recordActivityInBackground(user, request);

    return true;
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

  private recordActivityInBackground(
    user: AuthenticatedUser,
    request: {
      method?: string;
      baseUrl?: string;
      originalUrl?: string;
      route?: { path?: string };
      url?: string;
    },
  ): void {
    const actionName = this.resolveActionName(request);

    try {
      this.userActivityWorkerService.dispatchActivity(user.id, actionName);
    } catch (error) {
      this.logger.warn(`Failed to dispatch activity worker for user ${user.id}`, {
        actionName,
        error: this.formatAuthError(error),
      });
    }
  }

  private resolveActionName(request: {
    method?: string;
    baseUrl?: string;
    originalUrl?: string;
    route?: { path?: string };
    url?: string;
  }): string {
    const method = request.method?.toUpperCase()?.trim() || 'UNKNOWN';
    const routePath = request.route?.path?.trim();
    const baseUrl = request.baseUrl?.trim() || '';

    if (routePath) {
      return `${method} ${baseUrl}${routePath}`;
    }

    const rawPath = request.originalUrl?.trim() || request.url?.trim() || '/';
    const pathOnly = rawPath.split('?')[0] || '/';
    return `${method} ${pathOnly}`;
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
}
