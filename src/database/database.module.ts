import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }

  return value.toLowerCase() === 'true';
};

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        const synchronize = parseBoolean(
          config.get<string>('DB_SYNCHRONIZE'),
          true,
        );
        const logging = parseBoolean(config.get<string>('DB_LOGGING'), false);
        const sslEnabled = parseBoolean(config.get<string>('DB_SSL'), false);

        if (databaseUrl) {
          return {
            type: 'postgres' as const,
            url: databaseUrl,
            autoLoadEntities: true,
            synchronize,
            logging,
            ssl: sslEnabled ? { rejectUnauthorized: false } : false,
          };
        }

        const host = config.get<string>('DB_HOST');
        const port = config.get<number>('DB_PORT');
        const username = config.get<string>('DB_USERNAME');
        const password = config.get<string>('DB_PASSWORD');
        const database = config.get<string>('DB_NAME');

        if (!host || !port || !username || !password || !database) {
          throw new Error(
            'Missing PostgreSQL config. Provide DATABASE_URL or DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME.',
          );
        }

        return {
          type: 'postgres' as const,
          host,
          port,
          username,
          password,
          database,
          autoLoadEntities: true,
          synchronize,
          logging,
          ssl: sslEnabled ? { rejectUnauthorized: false } : false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
