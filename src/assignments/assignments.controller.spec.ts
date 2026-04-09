import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import request = require('supertest');
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { SubmissionStatus } from './entities/assignment-submission.entity';
import { SubmissionStateStatus } from './dto/assignment-submission-response.dto';

describe('AssignmentsController (integration)', () => {
  let app: INestApplication;
  const learnerId = randomUUID();
  const learnerUsername = 'local-learner';
  const lessonId = randomUUID();
  const courseSlug = 'test-course';
  const lessonSlug = 'test-assignment';

  const submitAssignmentMock = jest.fn<AssignmentsService['submitAssignment']>();
  const submitAssignmentBySlugsMock = jest.fn<AssignmentsService['submitAssignmentBySlugs']>();
  const getSubmissionStateBySlugsMock = jest.fn<AssignmentsService['getSubmissionStateBySlugs']>();
  const updateSubmissionStatusMock = jest.fn<AssignmentsService['updateSubmissionStatus']>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AssignmentsController],
      providers: [
        {
          provide: AssignmentsService,
          useValue: {
            submitAssignment: submitAssignmentMock,
            submitAssignmentBySlugs: submitAssignmentBySlugsMock,
            getSubmissionStateBySlugs: getSubmissionStateBySlugsMock,
            updateSubmissionStatus: updateSubmissionStatusMock,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    app.use((req: Request & { user?: { id: string; username: string } }, _res: Response, next: NextFunction) => {
      req.user = { id: learnerId, username: learnerUsername };
      next();
    });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    submitAssignmentMock.mockReset();
    submitAssignmentBySlugsMock.mockReset();
    getSubmissionStateBySlugsMock.mockReset();
    updateSubmissionStatusMock.mockReset();
  });

  it('updates a submission status', async () => {
    const submissionId = randomUUID();
    updateSubmissionStatusMock.mockResolvedValue({
      submissionId,
      lessonId,
      userId: learnerId,
      status: SubmissionStatus.GRADING,
      canSubmit: false,
      version: 1,
      contentText: 'This is my answer',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      files: [],
    });

    await request(app.getHttpServer())
      .patch(`/submissions/${submissionId}/status`)
      .send({ status: SubmissionStatus.GRADING })
      .expect(200);

    expect(updateSubmissionStatusMock).toHaveBeenCalledWith(
      submissionId,
      SubmissionStatus.GRADING,
      learnerId,
    );
  });

  it('returns lesson submission state by slugs', async () => {
    getSubmissionStateBySlugsMock.mockResolvedValue({
      status: SubmissionStateStatus.ACTIVE,
      canSubmit: true,
      latestSubmission: null,
    });

    await request(app.getHttpServer())
      .get(`/courses/${courseSlug}/lessons/${lessonSlug}/submissions/state`)
      .expect(200);

    expect(getSubmissionStateBySlugsMock).toHaveBeenCalledWith(
      courseSlug,
      lessonSlug,
      learnerId,
    );
  });

  it('accepts text-only payload', async () => {
    submitAssignmentMock.mockResolvedValue({
      submissionId: randomUUID(),
      lessonId,
      userId: learnerId,
      status: SubmissionStatus.WAITING,
      canSubmit: true,
      version: 1,
      contentText: 'This is my answer',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      files: [],
    });

    await request(app.getHttpServer())
      .post(`/lessons/${lessonId}/submissions`)
      .field('contentText', 'This is my answer')
      .expect(201);

    expect(submitAssignmentMock).toHaveBeenCalledWith(
      lessonId,
      learnerId,
      'This is my answer',
      [],
      undefined,
      learnerUsername,
    );
  });

  it('accepts file payload', async () => {
    submitAssignmentMock.mockResolvedValue({
      submissionId: randomUUID(),
      lessonId,
      userId: learnerId,
      status: SubmissionStatus.WAITING,
      canSubmit: true,
      version: 1,
      contentText: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      files: [],
    });

    await request(app.getHttpServer())
      .post(`/lessons/${lessonId}/submissions`)
      .attach('files', Buffer.from('hello world'), 'answer.txt')
      .field('fileCount', '1')
      .expect(201);

    expect(submitAssignmentMock).toHaveBeenCalled();
  });

  it('accepts slug-based payload', async () => {
    submitAssignmentBySlugsMock.mockResolvedValue({
      submissionId: randomUUID(),
      lessonId,
      userId: learnerId,
      status: SubmissionStatus.WAITING,
      canSubmit: true,
      version: 1,
      contentText: 'This is my answer',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      files: [],
    });

    await request(app.getHttpServer())
      .post(`/courses/${courseSlug}/lessons/${lessonSlug}/submissions`)
      .field('contentText', 'This is my answer')
      .expect(201);

    expect(submitAssignmentBySlugsMock).toHaveBeenCalledWith(
      courseSlug,
      lessonSlug,
      learnerId,
      'This is my answer',
      [],
      undefined,
      learnerUsername,
    );
  });

  it('rejects empty payload', async () => {
    await request(app.getHttpServer())
      .post(`/lessons/${lessonId}/submissions`)
      .expect(400);
  });
});
