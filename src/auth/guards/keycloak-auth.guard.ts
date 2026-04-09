import {
  Injectable,
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Observable } from 'rxjs';

/**
 * Global auth guard that validates Keycloak JWT tokens.
 * Routes decorated with @Public() bypass authentication.
 */
@Injectable()
export class KeycloakAuthGuard extends AuthGuard('keycloak') {
  private readonly logger = new Logger(KeycloakAuthGuard.name);

  constructor(private reflector: Reflector) {
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
}
