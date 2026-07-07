import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { KeycloakStrategy } from './strategies/keycloak.strategy';
import { KeycloakAuthGuard } from './guards/keycloak-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'keycloak' }), UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    KeycloakStrategy,

    // Register KeycloakAuthGuard globally — all routes require auth by default.
    // Use @Public() decorator to opt out.
    {
      provide: APP_GUARD,
      useClass: KeycloakAuthGuard,
    },

    // Register RolesGuard globally — checks @Roles() decorator on each route.
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
