import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import {
  Submission,
  SubmissionStatus,
} from './entities/assignment-submission.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import {
  AssignmentStorageService,
  SubmissionFile,
} from './storage/assignment-storage.service';
import {
  AssignmentSubmissionResponseDto,
  AssignmentSubmissionStateDto,
  SubmissionStateStatus,
} from './dto/assignment-submission-response.dto';
import { SubmissionFileEntity } from './entities/submission-file.entity';

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Course)
    private readonly courseRepo: Repository<Course>,
    @InjectRepository(Lesson)
    private readonly lessonRepo: Repository<Lesson>,
    @InjectRepository(Submission)
    private readonly submissionRepo: Repository<Submission>,
    @InjectRepository(SubmissionFileEntity)
    private readonly submissionFileRepo: Repository<SubmissionFileEntity>,
    private readonly assignmentStorageService: AssignmentStorageService,
    private readonly configService: ConfigService,
  ) {}

  async submitAssignment(
    lessonId: string,
    userId: string,
    contentText: string | undefined,
    files: SubmissionFile[] = [],
    fileCount?: number,
    username?: string,
    folderContext?: { courseSlug?: string; lessonSlug?: string },
    retryCount = 0,
  ): Promise<AssignmentSubmissionResponseDto> {
    const normalizedText = contentText?.trim() || '';
    const uploadedFiles = files || [];
    const maxFiles = this.configService.get<number>('submissions.maxFiles', 10);

    if (uploadedFiles.length > maxFiles) {
      throw new BadRequestException(
        `File count exceeds limit (${maxFiles})`,
      );
    }

    if (fileCount !== undefined && fileCount !== uploadedFiles.length) {
      throw new BadRequestException(
        `fileCount mismatch: expected ${fileCount}, received ${uploadedFiles.length}`,
      );
    }

    if (!normalizedText && uploadedFiles.length === 0) {
      throw new BadRequestException(
        'Either contentText or files must be provided',
      );
    }

    const lessonExists = await this.lessonRepo.exists({
      where: { id: lessonId },
    });

    if (!lessonExists) {
      throw new NotFoundException('Lesson not found');
    }

    this.validateFiles(uploadedFiles);

    const antiSpamWindowSeconds = this.configService.get<number>(
      'submissions.antiSpamWindowSeconds',
      30,
    );
    const lastSubmission = await this.submissionRepo.findOne({
      where: { lessonId, userId },
      select: { createdAt: true, status: true },
      order: { createdAt: 'DESC' },
    });

    const antiSpamExemptStatuses = new Set<SubmissionStatus>([
      SubmissionStatus.WAITING,
      SubmissionStatus.FAIL,
    ]);
    const lastStatus = lastSubmission
      ? this.normalizeSubmissionStatus(lastSubmission.status)
      : null;
    const shouldApplyAntiSpam = !lastStatus || !antiSpamExemptStatuses.has(lastStatus);

    if (
      shouldApplyAntiSpam &&
      lastSubmission &&
      Date.now() - lastSubmission.createdAt.getTime() < antiSpamWindowSeconds * 1000
    ) {
      throw new HttpException(
        `Please wait ${antiSpamWindowSeconds}s before creating a new submission`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const blockingSubmission = await this.submissionRepo.findOne({
      where: [
        { lessonId, userId, status: SubmissionStatus.GRADING },
      ],
      select: { status: true },
      order: { createdAt: 'DESC' },
    });
    if (blockingSubmission) {
      const blockingMessage =
        blockingSubmission.status === SubmissionStatus.GRADING
          ? 'This submission is being graded and cannot be resubmitted yet'
          : 'A submission is currently blocked for resubmission';

      throw new HttpException(
        blockingMessage,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passedExists = await this.submissionRepo.exists({
      where: { lessonId, userId, status: SubmissionStatus.PASS },
    });
    if (passedExists) {
      throw new ForbiddenException(
        'Resubmission is prohibited after the lesson is passed',
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    const uploadedDriveFileIds: string[] = [];
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager
        .createQueryBuilder()
        .update(Submission)
        .set({
          status: SubmissionStatus.SUPERSEDED,
          updatedBy: userId,
          updatedAt: () => 'NOW()',
        })
        .where('user_id = :userId', { userId })
        .andWhere('lesson_id = :lessonId', { lessonId })
        .andWhere('status != :passed', { passed: SubmissionStatus.PASS })
        .execute();

      const versionRaw = await queryRunner.manager
        .createQueryBuilder(Submission, 'submission')
        .select('COALESCE(MAX(submission.version), 0)', 'maxVersion')
        .where('submission.user_id = :userId', { userId })
        .andWhere('submission.lesson_id = :lessonId', { lessonId })
        .getRawOne<{ maxVersion: string }>();

      const nextVersion = Number(versionRaw?.maxVersion || 0) + 1;

      const submission = await queryRunner.manager.save(
        queryRunner.manager.create(Submission, {
          lessonId,
          userId,
          status: SubmissionStatus.WAITING,
          version: nextVersion,
          contentText: normalizedText || null,
          createdBy: userId,
          updatedBy: null,
        }),
      );

      const createdFiles: SubmissionFileEntity[] = [];
      const submissionFolderId = uploadedFiles.length > 0
        ? await this.assignmentStorageService.ensureSubmissionFolder({
          submissionId: submission.id,
          version: submission.version,
          username,
          courseSlug: folderContext?.courseSlug,
          lessonSlug: folderContext?.lessonSlug,
          lessonId,
        })
        : null;

      for (const file of uploadedFiles) {
        const sanitizedFileName = this.sanitizeFilename(file.originalname);
        const driveResult = await this.assignmentStorageService.uploadSubmissionFile(
          file,
          sanitizedFileName,
          submission.id,
          submissionFolderId || undefined,
        );
        uploadedDriveFileIds.push(driveResult.driveFileId);

        const fileEntity = await queryRunner.manager.save(
          queryRunner.manager.create(SubmissionFileEntity, {
            submissionId: submission.id,
            fileName: sanitizedFileName,
            fileMimetype: driveResult.fileMimetype,
            driveFileId: driveResult.driveFileId,
            driveUrl: driveResult.driveUrl,
            createdBy: userId,
            updatedBy: null,
          }),
        );

        createdFiles.push(fileEntity);
      }

      const savedFileCount = await queryRunner.manager.count(SubmissionFileEntity, {
        where: { submissionId: submission.id },
      });

      if (savedFileCount !== uploadedFiles.length) {
        throw new ServiceUnavailableException(
          'Submission integrity check failed',
        );
      }

      await queryRunner.commitTransaction();

      return this.toSubmissionResponse(submission, createdFiles);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      await this.safeDeleteDriveFiles(uploadedDriveFileIds);

      if (this.isWaitingUniqueViolation(error)) {
        if (retryCount < 1) {
          await this.submissionRepo
            .createQueryBuilder()
            .update(Submission)
            .set({
              status: SubmissionStatus.SUPERSEDED,
              updatedBy: userId,
              updatedAt: () => 'NOW()',
            })
            .where('user_id = :userId', { userId })
            .andWhere('lesson_id = :lessonId', { lessonId })
            .andWhere('status = :waiting', { waiting: SubmissionStatus.WAITING })
            .execute();

          return this.submitAssignment(
            lessonId,
            userId,
            contentText,
            files,
            fileCount,
            username,
            folderContext,
            retryCount + 1,
          );
        }

        throw new HttpException(
          'A waiting submission already exists for this lesson',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      throw new ServiceUnavailableException(
        'Submission synchronization failed. Please retry later.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  async submitAssignmentBySlugs(
    courseSlug: string,
    lessonSlug: string,
    userId: string,
    contentText: string | undefined,
    files: SubmissionFile[] = [],
    fileCount?: number,
    username?: string,
    retryCount = 0,
  ): Promise<AssignmentSubmissionResponseDto> {
    const lesson = await this.findOrCreateLessonBySlugs(courseSlug, lessonSlug);

    return this.submitAssignment(
      lesson.id,
      userId,
      contentText,
      files,
      fileCount,
      username,
      {
        courseSlug,
        lessonSlug,
      },
      retryCount,
    );
  }

  async getSubmissionStateBySlugs(
    courseSlug: string,
    lessonSlug: string,
    userId: string,
  ): Promise<AssignmentSubmissionStateDto> {
    const lesson = await this.findLessonBySlugsOrFail(courseSlug, lessonSlug);

    return this.getSubmissionState(lesson.id, userId);
  }

  private normalizeSlugs(courseSlug: string, lessonSlug: string): {
    courseSlug: string;
    lessonSlug: string;
  } {
    const normalizedCourseSlug = courseSlug.trim();
    const normalizedLessonSlug = lessonSlug.trim();

    if (!normalizedCourseSlug || !normalizedLessonSlug) {
      throw new NotFoundException('Lesson not found');
    }

    return {
      courseSlug: normalizedCourseSlug,
      lessonSlug: normalizedLessonSlug,
    };
  }

  private async findLessonBySlugs(
    courseSlug: string,
    lessonSlug: string,
  ): Promise<Pick<Lesson, 'id'> | null> {
    const normalized = this.normalizeSlugs(courseSlug, lessonSlug);

    return this.lessonRepo
      .createQueryBuilder('lesson')
      .innerJoin('lesson.course', 'course')
      .select(['lesson.id'])
      .where('course.slug = :courseSlug', { courseSlug: normalized.courseSlug })
      .andWhere('lesson.slug = :lessonSlug', { lessonSlug: normalized.lessonSlug })
      .getOne();
  }

  private async findLessonBySlugsOrFail(
    courseSlug: string,
    lessonSlug: string,
  ): Promise<Pick<Lesson, 'id'>> {
    const lesson = await this.findLessonBySlugs(courseSlug, lessonSlug);
    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }

    return lesson;
  }

  private async findOrCreateLessonBySlugs(
    courseSlug: string,
    lessonSlug: string,
  ): Promise<Pick<Lesson, 'id'>> {
    const normalized = this.normalizeSlugs(courseSlug, lessonSlug);

    const existingLesson = await this.findLessonBySlugs(
      normalized.courseSlug,
      normalized.lessonSlug,
    );

    if (existingLesson) {
      return existingLesson;
    }

    let course = await this.courseRepo.findOne({
      where: { slug: normalized.courseSlug },
    });

    if (!course) {
      course = await this.courseRepo.save(
        this.courseRepo.create({
          slug: normalized.courseSlug,
          title: this.slugToTitle(normalized.courseSlug),
        }),
      );
    }

    try {
      const createdLesson = await this.lessonRepo.save(
        this.lessonRepo.create({
          slug: normalized.lessonSlug,
          title: this.slugToTitle(normalized.lessonSlug),
          courseId: course.id,
        }),
      );

      return { id: createdLesson.id };
    } catch (error) {
      if (!(error instanceof QueryFailedError)) {
        throw error;
      }

      const retryExisting = await this.lessonRepo
        .createQueryBuilder('lesson')
        .innerJoin('lesson.course', 'course')
        .select(['lesson.id'])
        .where('course.slug = :courseSlug', { courseSlug: normalized.courseSlug })
        .andWhere('lesson.slug = :lessonSlug', { lessonSlug: normalized.lessonSlug })
        .getOne();

      if (retryExisting) {
        return retryExisting;
      }

      throw error;
    }
  }

  private slugToTitle(slug: string): string {
    return slug
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  async getSubmissionState(
    lessonId: string,
    userId: string,
  ): Promise<AssignmentSubmissionStateDto> {
    const latestSubmission = await this.submissionRepo.findOne({
      where: { lessonId, userId },
      order: { createdAt: 'DESC' },
    });

    if (!latestSubmission) {
      return {
        status: SubmissionStateStatus.ACTIVE,
        canSubmit: true,
        latestSubmission: null,
      };
    }

    const latestFiles = await this.submissionFileRepo.find({
      where: { submissionId: latestSubmission.id },
      order: { createdAt: 'ASC' },
    });

    return {
      status: this.toSubmissionStateStatus(latestSubmission.status),
      canSubmit: this.canSubmitFromStatus(latestSubmission.status),
      latestSubmission: this.toSubmissionResponse(latestSubmission, latestFiles),
    };
  }

  async updateSubmissionStatus(
    submissionId: string,
    nextStatus: SubmissionStatus,
    actorId: string,
  ): Promise<AssignmentSubmissionResponseDto> {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    const currentStatus = this.normalizeSubmissionStatus(submission.status);
    const allowedTransitions: Record<SubmissionStatus, SubmissionStatus[]> = {
      [SubmissionStatus.WAITING]: [SubmissionStatus.GRADING, SubmissionStatus.FAIL, SubmissionStatus.PASS],
      [SubmissionStatus.GRADING]: [SubmissionStatus.PASS, SubmissionStatus.FAIL],
      [SubmissionStatus.PASS]: [],
      [SubmissionStatus.FAIL]: [],
      [SubmissionStatus.SUPERSEDED]: [],
      [SubmissionStatus.FILE_LOST]: [],
      [SubmissionStatus.ARCHIVED]: [],
    };

    if (!allowedTransitions[currentStatus].includes(nextStatus)) {
      throw new BadRequestException(
        `Cannot change submission status from ${currentStatus} to ${nextStatus}`,
      );
    }

    submission.status = nextStatus;
    submission.updatedBy = actorId;
    const savedSubmission = await this.submissionRepo.save(submission);
    const savedFiles = await this.submissionFileRepo.find({
      where: { submissionId: savedSubmission.id },
      order: { createdAt: 'ASC' },
    });

    return this.toSubmissionResponse(savedSubmission, savedFiles);
  }

  async cleanupSupersededSubmissions(): Promise<number> {
    const retentionDays = this.configService.get<number>('submissions.retentionDays', 30);
    const batchSize = this.configService.get<number>('submissions.cleanupBatchSize', 100);
    const systemActor = this.configService.get<string>(
      'submissions.systemActorId',
      '00000000-0000-0000-0000-000000000000',
    );

    const candidates = await this.submissionRepo
      .createQueryBuilder('submission')
      .where('submission.status = :superseded', {
        superseded: SubmissionStatus.SUPERSEDED,
      })
      .andWhere("submission.updated_at < NOW() - (:retentionDays || ' days')::interval", {
        retentionDays,
      })
      .orderBy('submission.updated_at', 'ASC')
      .limit(batchSize)
      .getMany();

    let archivedCount = 0;

    for (const submission of candidates) {
      await this.dataSource.transaction(async (manager) => {
        await manager
          .createQueryBuilder()
          .update(Submission)
          .set({
            status: SubmissionStatus.ARCHIVED,
            updatedBy: systemActor,
            updatedAt: () => 'NOW()',
          })
          .where('id = :submissionId', { submissionId: submission.id })
          .execute();

        // Keep DB audit rows while removing Drive pointers; Drive files are removed by orphan scan after DB purge.
        await manager
          .createQueryBuilder()
          .update(SubmissionFileEntity)
          .set({
            driveFileId: null,
            driveUrl: null,
            updatedBy: systemActor,
            updatedAt: () => 'NOW()',
          })
          .where('submission_id = :submissionId', { submissionId: submission.id })
          .execute();
      });

      archivedCount += 1;
    }

    return archivedCount;
  }

  async cleanupOrphanDriveFiles(): Promise<number> {
    const driveEnabled = this.configService.get<boolean>('submissions.driveEnabled', false);
    if (!driveEnabled) {
      return 0;
    }

    const batchSize = this.configService.get<number>('submissions.orphanScanBatchSize', 100);
    const candidates = await this.assignmentStorageService.listOrphanCandidates(batchSize);
    let deletedCount = 0;

    for (const candidate of candidates) {
      const exists = await this.submissionRepo.exists({
        where: { id: candidate.submissionId },
      });

      if (!exists) {
        await this.safeDeleteDriveFiles([candidate.driveFileId]);
        deletedCount += 1;
      }
    }

    return deletedCount;
  }

  async cleanupArchivedSubmissions(): Promise<number> {
    const purgeDays = this.configService.get<number>('submissions.archivedPurgeDays', 0);
    if (purgeDays <= 0) {
      return 0;
    }

    const batchSize = this.configService.get<number>('submissions.cleanupBatchSize', 100);

    const candidates = await this.submissionRepo
      .createQueryBuilder('submission')
      .select('submission.id', 'id')
      .where('submission.status = :archived', {
        archived: SubmissionStatus.ARCHIVED,
      })
      .andWhere("submission.updated_at < NOW() - (:purgeDays || ' days')::interval", {
        purgeDays,
      })
      .orderBy('submission.updated_at', 'ASC')
      .limit(batchSize)
      .getRawMany<{ id: string }>();

    if (candidates.length === 0) {
      return 0;
    }

    const ids = candidates.map((candidate) => candidate.id);

    await this.submissionRepo
      .createQueryBuilder()
      .delete()
      .from(Submission)
      .where('id IN (:...ids)', { ids })
      .execute();

    return ids.length;
  }

  private validateFiles(files: SubmissionFile[]): void {
    const maxFileSizeMb = this.configService.get<number>('submissions.maxFileSizeMb', 10);
    const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;

    const allowedMimeTypes = this.configService.get<string[]>(
      'submissions.allowedMimeTypes',
      [
        'application/pdf',
        'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg',
      ],
    );

    for (const file of files) {
      if (file.size > maxFileSizeBytes) {
        throw new PayloadTooLargeException(
          `File ${file.originalname} exceeds ${maxFileSizeMb}MB`,
        );
      }

      if (!allowedMimeTypes.includes(file.mimetype)) {
        throw new UnsupportedMediaTypeException(
          `Unsupported file type: ${file.mimetype}`,
        );
      }
    }
  }

  private sanitizeFilename(fileName: string): string {
    const baseName = fileName.split(/[\\/]/).pop() || fileName;
    const cleaned = baseName
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');

    return cleaned.slice(0, 200) || 'uploaded_file';
  }

  private isWaitingUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as {
      code?: string;
      constraint?: string;
    };

    return (
      driverError.code === '23505' &&
      driverError.constraint === 'idx_pending_sub'
    );
  }

  private toSubmissionResponse(
    submission: Submission,
    files: SubmissionFileEntity[],
  ): AssignmentSubmissionResponseDto {
    return {
      submissionId: submission.id,
      lessonId: submission.lessonId,
      userId: submission.userId,
      status: this.normalizeSubmissionStatus(submission.status),
      canSubmit: this.canSubmitFromStatus(submission.status),
      version: submission.version,
      contentText: submission.contentText,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
      files: files.map((submissionFile) => ({
        id: submissionFile.id,
        fileName: submissionFile.fileName,
        fileMimetype: submissionFile.fileMimetype,
        driveFileId: submissionFile.driveFileId,
        driveUrl: submissionFile.driveUrl,
        createdAt: submissionFile.createdAt,
      })),
    };
  }

  private normalizeSubmissionStatus(status: SubmissionStatus | string): SubmissionStatus {
    return status as SubmissionStatus;
  }

  private toSubmissionStateStatus(status: SubmissionStatus | string): SubmissionStateStatus {
    switch (this.normalizeSubmissionStatus(status)) {
      case SubmissionStatus.WAITING:
        return SubmissionStateStatus.WAITING;
      case SubmissionStatus.GRADING:
        return SubmissionStateStatus.GRADING;
      case SubmissionStatus.PASS:
        return SubmissionStateStatus.PASS;
      case SubmissionStatus.FAIL:
        return SubmissionStateStatus.FAIL;
      default:
        return SubmissionStateStatus.ACTIVE;
    }
  }

  private canSubmitFromStatus(status: SubmissionStatus | string): boolean {
    switch (this.normalizeSubmissionStatus(status)) {
      case SubmissionStatus.GRADING:
      case SubmissionStatus.PASS:
        return false;
      default:
        return true;
    }
  }

  private async safeDeleteDriveFiles(driveFileIds: string[]): Promise<void> {
    for (const driveFileId of driveFileIds) {
      try {
        await this.assignmentStorageService.deleteDriveFile(driveFileId);
      } catch (error) {
        // Best-effort cleanup; grace period job will retry failed deletions
        this.logger.warn(
          `Failed to delete Drive file ${driveFileId}: ${(error as Error)?.message || 'unknown error'}`,
        );
      }
    }
  }
}
