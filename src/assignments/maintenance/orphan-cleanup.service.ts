import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AssignmentsService } from '../assignments.service';

/**
 * Service chạy cron job định kỳ để dọn dẹp file trên Google Drive không còn submission (orphan)
 * Chỉ chạy khi submissions.driveEnabled = true
 */
@Injectable()
export class OrphanCleanupService implements OnModuleInit {
  private readonly logger = new Logger(OrphanCleanupService.name);
  private static readonly DEFAULT_ORPHAN_SCHEDULE = '*/10 * * * *';
  private static readonly DEFAULT_TIMEZONE = 'UTC';
  private isCleanupRunning = false;

  constructor(
    private readonly assignmentsService: AssignmentsService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const driveEnabled = this.configService.get<boolean>('submissions.driveEnabled', false);

    if (!driveEnabled) {
      this.logger.log('Google Drive upload is disabled; skipping orphan cleanup cron registration');
      return;
    }

    const orphanSchedule = this.configService.get<string>(
      'submissions.orphanScanSchedule',
      OrphanCleanupService.DEFAULT_ORPHAN_SCHEDULE,
    );
    const timezone = this.configService.get<string>(
      'submissions.serverTimezone',
      OrphanCleanupService.DEFAULT_TIMEZONE,
    );

    this.logger.log('Orphan drive file cleanup is enabled');

    this.registerCleanupJob(orphanSchedule, timezone);
  }

  private registerCleanupJob(cronExpression: string, timezone: string): void {
    const onTick = () => {
      void this.cleanupOrphanDriveFiles();
    };

    let job: CronJob;
    let activeCronExpression = cronExpression;
    let activeTimezone = timezone;

    try {
      job = new CronJob(cronExpression, onTick, null, false, timezone);
    } catch (error) {
      this.logger.warn(
        `Invalid cron configuration for orphan cleanup (schedule="${cronExpression}", tz=${timezone}). Falling back to "${OrphanCleanupService.DEFAULT_ORPHAN_SCHEDULE}" in UTC`,
      );
      activeCronExpression = OrphanCleanupService.DEFAULT_ORPHAN_SCHEDULE;
      activeTimezone = OrphanCleanupService.DEFAULT_TIMEZONE;
      job = new CronJob(
        activeCronExpression,
        onTick,
        null,
        false,
        activeTimezone,
      );
    }

    this.schedulerRegistry.addCronJob('submission.cleanup.orphans', job);
    job.start();
    this.logger.log(
      `Registered cron job for orphan cleanup with schedule "${activeCronExpression}" (tz=${activeTimezone})`,
    );
  }

  private async cleanupOrphanDriveFiles(): Promise<void> {
    if (this.isCleanupRunning) {
      this.logger.warn('Skipping orphan cleanup tick because previous run is still in progress');
      return;
    }

    this.isCleanupRunning = true;
    try {
      const deleted = await this.assignmentsService.cleanupOrphanDriveFiles();
      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} orphan drive files`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup orphan drive files', error as Error);
    } finally {
      this.isCleanupRunning = false;
    }
  }
}
