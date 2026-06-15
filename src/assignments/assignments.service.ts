import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
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
import { SubmissionConstraintsDto } from './dto/submission-constraints.dto';
import { Course } from '../courses/entities/course.entity';
import { submissionDefaults } from '../config/submissions.config';

@Injectable()
export class AssignmentsService {
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

  getSubmissionConstraints(): SubmissionConstraintsDto {
    return {
      maxContentLength: this.configService.get<number>(
        'submissions.maxContentLength',
        submissionDefaults.maxContentLength,
      ),
      maxFiles: this.configService.get<number>(
        'submissions.maxFiles',
        submissionDefaults.maxFiles,
      ),
      maxFileSizeMb: this.configService.get<number>(
        'submissions.maxFileSizeMb',
        submissionDefaults.maxFileSizeMb,
      ),
      allowedMimeTypes: this.configService.get<string[]>(
        'submissions.allowedMimeTypes',
        [...submissionDefaults.allowedMimeTypes],
      ),
    };
  }

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
    const maxFiles = this.configService.get<number>(
      'submissions.maxFiles',
      submissionDefaults.maxFiles,
    );
    const maxContentLength = this.configService.get<number>(
      'submissions.maxContentLength',
      submissionDefaults.maxContentLength,
    );

    if (uploadedFiles.length > maxFiles) {
      throw new BadRequestException(
        `File count exceeds limit (${maxFiles})`,
      );
    }

    if (normalizedText.length > maxContentLength) {
      throw new BadRequestException(
        `contentText exceeds maximum length (${maxContentLength})`,
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
      submissionDefaults.antiSpamWindowSeconds,
    );
    const lastSubmission = await this.submissionRepo.findOne({
      where: { lessonId, userId },
      select: { createdAt: true, status: true },
      order: { createdAt: 'DESC' },
    });

    if (
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
        { lessonId, userId, status: SubmissionStatus.PENDING },
        { lessonId, userId, status: SubmissionStatus.GRADING },
      ],
      select: { status: true },
      order: { createdAt: 'DESC' },
    });
    if (blockingSubmission) {
      const blockingMessage =
        blockingSubmission.status === SubmissionStatus.PENDING
          ? 'A submission is already being processed for this lesson'
          : blockingSubmission.status === SubmissionStatus.GRADING
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
          status: SubmissionStatus.PENDING,
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

      submission.status = SubmissionStatus.WAITING;
      submission.updatedBy = userId;
      const finalizedSubmission = await queryRunner.manager.save(submission);

      await queryRunner.commitTransaction();

      return this.toSubmissionResponse(finalizedSubmission, createdFiles);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      for (const driveFileId of uploadedDriveFileIds) {
        try {
          await this.assignmentStorageService.deleteDriveFile(driveFileId);
        } catch {
          // Best-effort rollback for failed submission transaction.
        }
      }

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
            .andWhere('status = :pending', { pending: SubmissionStatus.PENDING })
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
          'A PENDING submission already exists for this lesson',
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
    const lesson = await this.findOrCreateLessonBySlugsForSubmission(
      courseSlug,
      lessonSlug,
    );

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

  private async findOrCreateLessonBySlugsForSubmission(
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

    const course = await this.courseRepo
      .createQueryBuilder('course')
      .select(['course.id'])
      .where('LOWER(course.slug) = :courseSlug', {
        courseSlug: normalized.courseSlug,
      })
      .getOne();

    if (!course) {
      throw new NotFoundException('Lesson not found');
    }

    try {
      const createdLesson = await this.lessonRepo.save(
        this.lessonRepo.create({
          courseId: course.id,
          slug: normalized.lessonSlug,
          title: this.toLessonTitleFromSlug(normalized.lessonSlug),
        }),
      );

      return { id: createdLesson.id };
    } catch {
      const resolvedLesson = await this.findLessonBySlugs(
        normalized.courseSlug,
        normalized.lessonSlug,
      );

      if (resolvedLesson) {
        return resolvedLesson;
      }

      throw new NotFoundException('Lesson not found');
    }
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
    const normalizedCourseSlug = courseSlug.trim().toLowerCase();
    const normalizedLessonSlug = lessonSlug.trim().toLowerCase();

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
      .where('LOWER(course.slug) = :courseSlug', { courseSlug: normalized.courseSlug })
      .andWhere('LOWER(lesson.slug) = :lessonSlug', { lessonSlug: normalized.lessonSlug })
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
      [SubmissionStatus.PENDING]: [SubmissionStatus.WAITING],
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

  private validateFiles(files: SubmissionFile[]): void {
    const maxFileSizeMb = this.configService.get<number>(
      'submissions.maxFileSizeMb',
      submissionDefaults.maxFileSizeMb,
    );
    const allowedMimeTypes = this.configService.get<string[]>(
      'submissions.allowedMimeTypes',
      [...submissionDefaults.allowedMimeTypes],
    );
    const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;

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
    const maxFileNameLength = this.configService.get<number>(
      'submissions.fileNameMaxLength',
      submissionDefaults.fileNameMaxLength,
    );
    const baseName = fileName.split(/[\\/]/).pop() || fileName;
    const cleaned = baseName
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');

    return cleaned.slice(0, maxFileNameLength) || 'uploaded_file';
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
      case SubmissionStatus.PENDING:
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
      case SubmissionStatus.PENDING:
      case SubmissionStatus.GRADING:
      case SubmissionStatus.PASS:
        return false;
      default:
        return true;
    }
  }

  private toLessonTitleFromSlug(slug: string): string {
    return slug
      .split('-')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

}
