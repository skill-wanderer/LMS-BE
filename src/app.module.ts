import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { ProgressModule } from './progress/progress.module';
import { QuizScoresModule } from './quiz-scores/quiz-scores.module';
import keycloakConfig from './config/keycloak.config';
import submissionsConfig from './config/submissions.config';
import { AssignmentsModule } from './assignments/assignments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [keycloakConfig, submissionsConfig],
      envFilePath: '.env',
    }),
    DatabaseModule,
    AuthModule,
    ProgressModule,
    QuizScoresModule,
    AssignmentsModule,
  ],
})
export class AppModule {}
