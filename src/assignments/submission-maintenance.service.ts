import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AssignmentsService } from './assignments.service';

@Injectable()
export class SubmissionMaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(SubmissionMaintenanceService.name);
  private static readonly DEFAULT_CLEANUP_SCHEDULE = '*/5 * * * *';
  private static readonly DEFAULT_ORPHAN_SCHEDULE = '*/10 * * * *';
  private static readonly DEFAULT_TIMEZONE = 'UTC';
  private isSupersededCleanupRunning = false;
  private isOrphanCleanupRunning = false;

  constructor(
    private readonly assignmentsService: AssignmentsService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const schedule = this.configService.get<string>(
      'submissions.cleanupSchedule',
      SubmissionMaintenanceService.DEFAULT_CLEANUP_SCHEDULE,
    );
    const orphanSchedule = this.configService.get<string>(
      'submissions.orphanScanSchedule',
      SubmissionMaintenanceService.DEFAULT_ORPHAN_SCHEDULE,
    );
    const timezone = this.configService.get<string>(
      'submissions.serverTimezone',
      SubmissionMaintenanceService.DEFAULT_TIMEZONE,
    );
    const driveEnabled = this.configService.get<boolean>('submissions.driveEnabled', false);

    this.logger.log('Submission background maintenance is enabled');

    this.registerJob(
      'submission.cleanup.superseded',
      schedule,
      SubmissionMaintenanceService.DEFAULT_CLEANUP_SCHEDULE,
      timezone,
      () =>
      this.cleanupSupersededRecords(timezone),
    );
    if (driveEnabled) {
      this.registerJob(
        'submission.cleanup.orphans',
        orphanSchedule,
        SubmissionMaintenanceService.DEFAULT_ORPHAN_SCHEDULE,
        timezone,
        () => this.cleanupOrphanDriveFiles(),
      );
    } else {
      this.logger.log('Google Drive upload is disabled; skipping orphan cleanup cron registration');
    }
  }

  private registerJob(
    name: string,
    cronExpression: string,
    fallbackCronExpression: string,
    timezone: string,
    task: () => Promise<void>,
  ): void {
    const onTick = () => {
      void task();
    };

    let job: CronJob;
    let activeCronExpression = cronExpression;
    let activeTimezone = timezone;

    try {
      job = new CronJob(cronExpression, onTick, null, false, timezone);
    } catch (error) {
      this.logger.warn(
        `Invalid cron configuration for ${name} (schedule="${cronExpression}", tz=${timezone}). Falling back to schedule "${fallbackCronExpression}" in UTC`,
      );
      activeCronExpression = fallbackCronExpression;
      activeTimezone = SubmissionMaintenanceService.DEFAULT_TIMEZONE;
      job = new CronJob(
        activeCronExpression,
        onTick,
        null,
        false,
        activeTimezone,
      );
    }

    this.schedulerRegistry.addCronJob(name, job);
    job.start();
    this.logger.log(
      `Registered cron ${name} with schedule "${activeCronExpression}" (tz=${activeTimezone})`,
    );
  }

  private async cleanupSupersededRecords(timezone: string): Promise<void> {
    if (this.isSupersededCleanupRunning) {
      this.logger.warn('Skipping superseded cleanup tick because previous run is still in progress');
      return;
    }

    this.isSupersededCleanupRunning = true;
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
      this.logger.error('Failed cleanupSupersededRecords', error as Error);
    } finally {
      this.isSupersededCleanupRunning = false;
    }
  }

  private async cleanupOrphanDriveFiles(): Promise<void> {
    if (this.isOrphanCleanupRunning) {
      this.logger.warn('Skipping orphan cleanup tick because previous run is still in progress');
      return;
    }

    this.isOrphanCleanupRunning = true;
    try {
      const deleted = await this.assignmentsService.cleanupOrphanDriveFiles();
      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} orphan drive files`);
      }
    } catch (error) {
      this.logger.error('Failed cleanupOrphanDriveFiles', error as Error);
    } finally {
      this.isOrphanCleanupRunning = false;
    }
  }
}
