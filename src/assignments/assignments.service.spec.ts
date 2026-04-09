import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { DataSource, Repository } from 'typeorm';
import { AssignmentsService } from './assignments.service';
import { Course } from '../courses/entities/course.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { Submission, SubmissionStatus } from './entities/assignment-submission.entity';
import { SubmissionFileEntity } from './entities/submission-file.entity';
import { AssignmentStorageService } from './storage/assignment-storage.service';
import { DatabaseModule } from '../database/database.module';
import submissionsConfig from '../config/submissions.config';

jest.setTimeout(30000);

describe('AssignmentsService', () => {
  let service: AssignmentsService;
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let assignmentStorageService: AssignmentStorageService;
  let courseRepo: Repository<Course>;
  let lessonRepo: Repository<Lesson>;
  let submissionRepo: Repository<Submission>;
  let submissionFileRepo: Repository<SubmissionFileEntity>;
  let createdCourseId: string | null = null;
  let createdLessonId: string | null = null;
  const originalRetentionDays = process.env.SUBMISSIONS_RETENTION_DAYS;
  const uploadedFolderIds = new Set<string>();

  beforeAll(async () => {
    process.env.SUBMISSIONS_RETENTION_DAYS = '1';

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [submissionsConfig],
          envFilePath: '.env',
        }),
        DatabaseModule,
        TypeOrmModule.forFeature([Course, Lesson, Submission, SubmissionFileEntity]),
      ],
      providers: [AssignmentsService, AssignmentStorageService],
    }).compile();

    service = moduleRef.get(AssignmentsService);
    dataSource = moduleRef.get(DataSource);
    assignmentStorageService = moduleRef.get(AssignmentStorageService);
    courseRepo = dataSource.getRepository(Course);
    lessonRepo = dataSource.getRepository(Lesson);
    submissionRepo = dataSource.getRepository(Submission);
    submissionFileRepo = dataSource.getRepository(SubmissionFileEntity);

    const suffix = randomUUID().slice(0, 8);
    const course = await courseRepo.save(
      courseRepo.create({
        slug: `assignments-spec-course-${suffix}`,
        title: `Assignments Spec Course ${suffix}`,
      }),
    );
    createdCourseId = course.id;

    const lesson = await lessonRepo.save(
      lessonRepo.create({
        slug: `assignments-spec-lesson-${suffix}`,
        title: `Assignments Spec Lesson ${suffix}`,
        courseId: course.id,
      }),
    );
    createdLessonId = lesson.id;
  });

  afterEach(async () => {
    if (!createdLessonId) {
      return;
    }

    await submissionRepo
      .createQueryBuilder()
      .delete()
      .from(Submission)
      .where('lesson_id = :lessonId', { lessonId: createdLessonId })
      .execute();
  });

  afterAll(async () => {
    const oauthClientId = process.env.DRIVE_OAUTH_CLIENT_ID;
    const oauthClientSecret = process.env.DRIVE_OAUTH_CLIENT_SECRET;
    const oauthRefreshToken = process.env.DRIVE_OAUTH_REFRESH_TOKEN;
    if (oauthClientId && oauthClientSecret && oauthRefreshToken) {
      const oauthClient = new google.auth.OAuth2(oauthClientId, oauthClientSecret);
      oauthClient.setCredentials({ refresh_token: oauthRefreshToken });
      const drive = google.drive({ version: 'v3', auth: oauthClient });

      for (const folderId of uploadedFolderIds) {
        try {
          await drive.files.delete({ fileId: folderId, supportsAllDrives: true });
        } catch {
          // Best-effort cleanup for test-created folders.
        }
      }
    }

    if (createdLessonId) {
      await lessonRepo.delete({ id: createdLessonId });
    }
    if (createdCourseId) {
      await courseRepo.delete({ id: createdCourseId });
    }

    if (originalRetentionDays === undefined) {
      delete process.env.SUBMISSIONS_RETENTION_DAYS;
    } else {
      process.env.SUBMISSIONS_RETENTION_DAYS = originalRetentionDays;
    }

    await moduleRef.close();
  });

  it('rejects empty payload', async () => {
    const userId = randomUUID();
    await expect(
      service.submitAssignment(createdLessonId as string, userId, '   ', []),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when lesson is not found', async () => {
    const userId = randomUUID();

    await expect(
      service.submitAssignment(randomUUID(), userId, 'answer', []),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('archives superseded submissions, deletes drive assets, and keeps audit metadata rows', async () => {
    const actorId = randomUUID();
    const submissionEntity = submissionRepo.create({
        lessonId: createdLessonId as string,
        userId: randomUUID(),
        status: SubmissionStatus.SUPERSEDED,
        version: 1,
        contentText: 'superseded-real-retention-test',
        createdBy: actorId,
        updatedBy: actorId,
      } as Partial<Submission>);
    const submission = await submissionRepo.save(submissionEntity);

    const submissionFolderId = await assignmentStorageService.ensureSubmissionFolder({
      submissionId: submission.id,
      version: submission.version,
      username: 'retention-test-user',
      courseSlug: `course-${createdCourseId}`,
      lessonSlug: `lesson-${createdLessonId}`,
      lessonId: createdLessonId as string,
    });
    uploadedFolderIds.add(submissionFolderId);

    const uploadResult = await assignmentStorageService.uploadSubmissionFile(
      {
        originalname: 'retention-proof.txt',
        mimetype: 'text/plain',
        size: Buffer.byteLength('retention-flow-real-data'),
        buffer: Buffer.from('retention-flow-real-data'),
      },
      'retention-proof.txt',
      submission.id,
      submissionFolderId,
    );

    const submissionFile = submissionFileRepo.create({
        submissionId: submission.id,
        fileName: uploadResult.fileName,
        fileMimetype: 'text/plain',
        driveFileId: uploadResult.driveFileId,
        driveUrl: uploadResult.driveUrl,
        createdBy: actorId,
        updatedBy: actorId,
      } as Partial<SubmissionFileEntity>);
    await submissionFileRepo.save(submissionFile);

    await submissionRepo
      .createQueryBuilder()
      .update(Submission)
      .set({ updatedAt: () => "NOW() - INTERVAL '2 days'" })
      .where('id = :id', { id: submission.id })
      .execute();

    const oauthClient = new google.auth.OAuth2(
      process.env.DRIVE_OAUTH_CLIENT_ID,
      process.env.DRIVE_OAUTH_CLIENT_SECRET,
    );
    oauthClient.setCredentials({ refresh_token: process.env.DRIVE_OAUTH_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth: oauthClient });

    const driveFileBeforeCleanup = await drive.files.get({
      fileId: uploadResult.driveFileId,
      fields: 'id',
      supportsAllDrives: true,
    });

    const archivedCount = await service.cleanupSupersededSubmissions();

    const afterSubmission = await submissionRepo.findOne({
      where: { id: submission.id },
    });
    const afterFiles = await submissionFileRepo.find({
      where: { submissionId: submission.id },
    });

    let driveFileDeleted = false;
    try {
      await drive.files.get({
        fileId: uploadResult.driveFileId,
        fields: 'id',
        supportsAllDrives: true,
      });
    } catch {
      driveFileDeleted = true;
    }

    expect(driveFileBeforeCleanup.data.id).toBe(uploadResult.driveFileId);
    expect(archivedCount).toBe(1);
    expect(afterSubmission?.status).toBe(SubmissionStatus.ARCHIVED);
    expect(afterFiles).toHaveLength(1);
    expect(afterFiles[0]?.fileName).toBe(uploadResult.fileName);
    expect(afterFiles[0]?.driveFileId).toBeNull();
    expect(afterFiles[0]?.driveUrl).toBeNull();
    expect(driveFileDeleted).toBe(true);
  });
});
