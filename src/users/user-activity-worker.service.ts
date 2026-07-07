import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'node:worker_threads';
import { userDefaults } from '../config/users.config';

type ActivityWorkerMessage =
  | {
      type: 'activity-recorded';
      correlationId: string;
      userId: string;
    }
  | {
      type: 'activity-failed';
      correlationId: string;
      userId: string;
      error: {
        name?: string;
        message?: string;
        stack?: string;
      };
    };

@Injectable()
export class UserActivityWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(UserActivityWorkerService.name);
  private readonly actionNameMaxLength: number;
  private readonly workerName: string;
  private worker: Worker | null = null;

  constructor(private readonly configService: ConfigService) {
    this.actionNameMaxLength = this.configService.get<number>(
      'users.actionNameMaxLength',
      userDefaults.actionNameMaxLength,
    );
    this.workerName =
      this.configService.get<string>('USERS_ACTIVITY_WORKER_NAME') ??
      'user-activity-worker';
  }

  dispatchActivity(userId: string, actionName: string): void {
    const worker = this.ensureWorker();
    const correlationId = `${userId}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    worker.postMessage({
      correlationId,
      userId,
      actionName: this.normalizeActionName(actionName),
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) {
      return;
    }

    const worker = this.worker;
    this.worker = null;
    await worker.terminate();
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const worker = new Worker(this.buildWorkerScript(), {
      eval: true,
      name: this.workerName,
      workerData: {
        dbConfig: {
          host: this.configService.get<string>('DB_HOST', 'localhost'),
          port: this.configService.get<number>('DB_PORT', 5432),
          user: this.configService.get<string>('DB_USERNAME', 'postgres'),
          password: this.configService.get<string>('DB_PASSWORD', 'postgres'),
          database: this.configService.get<string>('DB_NAME', 'lms'),
        },
      },
    });

    worker.on('message', (message: ActivityWorkerMessage) => {
      if (message.type === 'activity-failed') {
        this.logger.warn(
          `Worker failed to record activity for user ${message.userId}`,
          message.error,
        );
      }
    });

    worker.on('error', (error) => {
      const formattedError =
        error instanceof Error
          ? error.stack ?? error.message
          : JSON.stringify(error);
      this.logger.error('User activity worker thread crashed', formattedError);
      this.worker = null;
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        this.logger.warn(`User activity worker exited with code ${code}`);
      }

      if (this.worker === worker) {
        this.worker = null;
      }
    });

    this.worker = worker;
    return worker;
  }

  private normalizeActionName(actionName: string): string {
    return actionName.trim().slice(0, this.actionNameMaxLength);
  }

  private buildWorkerScript(): string {
    return `
      const { parentPort, workerData } = require('node:worker_threads');
      const { Pool } = require('pg');

      const pool = new Pool(workerData.dbConfig);

      parentPort.on('message', async (job) => {
        try {
          await pool.query(
            \`UPDATE users
              SET
                last_activity_at = CURRENT_TIMESTAMP,
                last_action_name = $2
              WHERE id = $1\`,
            [job.userId, job.actionName],
          );

          parentPort.postMessage({
            type: 'activity-recorded',
            correlationId: job.correlationId,
            userId: job.userId,
          });
        } catch (error) {
          parentPort.postMessage({
            type: 'activity-failed',
            correlationId: job.correlationId,
            userId: job.userId,
            error: {
              name: error?.name,
              message: error?.message,
              stack: error?.stack,
            },
          });
        }
      });
    `;
  }
}
