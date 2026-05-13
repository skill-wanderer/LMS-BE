import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AssignmentsService } from '../assignments.service';

/**
 * Service chạy cron job định kỳ để dọn dẹp submission superseded (chuyển sang archived)
 * và xóa submission archived quá lâu khỏi DB
 */
@Injectable()
export class SupersededCleanupService implements OnModuleInit {
  private readonly logger = new Logger(SupersededCleanupService.name);
  private static readonly DEFAULT_CLEANUP_SCHEDULE = '*/5 * * * *';
  private static readonly DEFAULT_TIMEZONE = 'UTC';
  private isCleanupRunning = false;

  constructor(
    private readonly assignmentsService: AssignmentsService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const schedule = this.configService.get<string>(
      'submissions.cleanupSchedule',
      SupersededCleanupService.DEFAULT_CLEANUP_SCHEDULE,
    );
    const timezone = this.configService.get<string>(
      'submissions.serverTimezone',
      SupersededCleanupService.DEFAULT_TIMEZONE,
    );

    this.logger.log('Superseded submission cleanup is enabled');

    this.registerCleanupJob(schedule, timezone);
  }

  private registerCleanupJob(cronExpression: string, timezone: string): void {
    const onTick = () => {
      void this.cleanupSupersededRecords(timezone);
    };

    let job: CronJob;
    let activeCronExpression = cronExpression;
    let activeTimezone = timezone;

    try {
      job = new CronJob(cronExpression, onTick, null, false, timezone);
    } catch (error) {
      this.logger.warn(
        `Invalid cron configuration for superseded cleanup (schedule="${cronExpression}", tz=${timezone}). Falling back to "${SupersededCleanupService.DEFAULT_CLEANUP_SCHEDULE}" in UTC`,
      );
      activeCronExpression = SupersededCleanupService.DEFAULT_CLEANUP_SCHEDULE;
      activeTimezone = SupersededCleanupService.DEFAULT_TIMEZONE;
      job = new CronJob(
        activeCronExpression,
        onTick,
        null,
        false,
        activeTimezone,
      );
    }

    this.schedulerRegistry.addCronJob('submission.cleanup.superseded', job);
    job.start();
    this.logger.log(
      `Registered cron job for superseded cleanup with schedule "${activeCronExpression}" (tz=${activeTimezone})`,
    );
  }

  private async cleanupSupersededRecords(timezone: string): Promise<void> {
    if (this.isCleanupRunning) {
      this.logger.warn('Skipping superseded cleanup tick because previous run is still in progress');
      return;
    }

    this.isCleanupRunning = true;
    try {
      const archived = await this.assignmentsService.cleanupSupersededSubmissions();
      if (archived > 0) {
        this.logger.log(`Archived ${archived} superseded submissions (tz=${timezone})`);
      }

      const purged = await this.assignmentsService.cleanupArchivedSubmissions();
      if (purged > 0) {
        this.logger.log(`Purged ${purged} archived submissions (tz=${timezone})`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup superseded records', error as Error);
    } finally {
      this.isCleanupRunning = false;
    }
  }
}
