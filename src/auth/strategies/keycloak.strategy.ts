import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import {
  KeycloakTokenPayload,
  AuthenticatedUser,
} from '../interfaces/keycloak-token.interface';

@Injectable()
export class KeycloakStrategy extends PassportStrategy(Strategy, 'keycloak') {
  private readonly logger = new Logger(KeycloakStrategy.name);

  constructor(private readonly configService: ConfigService) {
    const bootstrapLogger = new Logger(KeycloakStrategy.name);
    const keycloakBaseUrl = configService.get<string>('keycloak.baseUrl');
    const keycloakRealm = configService.get<string>('keycloak.realm');
    const jwksUri = configService.get<string>('keycloak.jwksUri');
    const issuer = configService.get<string>('keycloak.issuerUrl');

    if (!jwksUri || !issuer) {
      throw new Error(
        'Keycloak configuration is incomplete. Please provide KEYCLOAK_BASE_URL/KEYCLOAK_REALM or explicit KEYCLOAK_ISSUER_URL and KEYCLOAK_JWKS_URI.',
      );
    }

    if (keycloakBaseUrl?.includes('/realms/')) {
      bootstrapLogger.warn(
        'KEYCLOAK_BASE_URL appears to contain a realm path. Use only host base URL (e.g. https://sso.example.com) and set KEYCLOAK_REALM separately.',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri,
      }),
      issuer,
      algorithms: ['RS256'],
    });

    this.logger.log('Keycloak JWT strategy initialized');
    this.logger.log(`Realm: ${keycloakRealm}`);
    this.logger.log(`JWKS URI: ${jwksUri}`);
    this.logger.log(`Issuer: ${issuer}`);
  }

  validate(payload: KeycloakTokenPayload): AuthenticatedUser {
    const configuredClientId = this.configService.get<string>('keycloak.clientId');

    const realmRoles = payload.realm_access?.roles ?? [];
    const tokenClientId = payload.azp;

    const configuredClientRoles =
      (configuredClientId
        ? payload.resource_access?.[configuredClientId]?.roles
        : undefined) ?? [];
    const tokenClientRoles =
      (tokenClientId ? payload.resource_access?.[tokenClientId]?.roles : undefined) ?? [];
    const allResourceRoles = Object.values(payload.resource_access ?? {}).flatMap(
      (access) => access?.roles ?? [],
    );

    const clientRoles =
      configuredClientRoles.length > 0
        ? configuredClientRoles
        : tokenClientRoles.length > 0
          ? tokenClientRoles
          : allResourceRoles;

    if (
      configuredClientId &&
      configuredClientRoles.length === 0 &&
      tokenClientRoles.length === 0 &&
      allResourceRoles.length > 0
    ) {
      this.logger.warn(
        `Configured KEYCLOAK_CLIENT_ID="${configuredClientId}" not found in token resource_access. Falling back to aggregate client roles.`,
      );
    }

    const dedupedRoles = Array.from(new Set([...realmRoles, ...clientRoles]));

    return {
      id: payload.sub,
      email: payload.email ?? '',
      emailVerified: payload.email_verified ?? false,
      username: payload.preferred_username ?? payload.sub,
      firstName: payload.given_name ?? '',
      lastName: payload.family_name ?? '',
      name:
        payload.name ||
        [payload.given_name, payload.family_name].filter(Boolean).join(' ') ||
        payload.preferred_username ||
        payload.sub,
      roles: dedupedRoles,
      realmRoles,
      clientRoles,
      tokenPayload: payload,
    };
  }
}