import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AssignmentsService } from './assignments.service';
import { Course } from '../courses/entities/course.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { Submission } from './entities/assignment-submission.entity';
import { SubmissionFileEntity } from './entities/submission-file.entity';
import { AssignmentStorageService } from './storage/assignment-storage.service';

describe('AssignmentsService', () => {
  let service: AssignmentsService;
  let lessonRepo: { exists: jest.MockedFunction<Repository<Lesson>['exists']> };
  let lessonId: string;
  let userId: string;

  beforeEach(async () => {
    lessonId = randomUUID();
    userId = randomUUID();

    lessonRepo = {
      exists: jest.fn<Repository<Lesson>['exists']>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn(),
            transaction: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Course),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Lesson),
          useValue: lessonRepo,
        },
        {
          provide: getRepositoryToken(Submission),
          useValue: {
            findOne: jest.fn(),
            exists: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SubmissionFileEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: AssignmentStorageService,
          useValue: {
            uploadSubmissionFile: jest.fn(),
            deleteDriveFile: jest.fn(),
            listOrphanCandidates: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: unknown) => {
              const map: Record<string, unknown> = {
                'submissions.maxFiles': 10,
                'submissions.maxFileSizeMb': 10,
                'submissions.allowedMimeTypes': ['application/pdf', 'text/plain'],
                'submissions.antiSpamWindowSeconds': 30,
              };
              return map[key] ?? defaultValue;
            },
          },
        },
      ],
    }).compile();

    service = module.get<AssignmentsService>(AssignmentsService);
  });

  it('rejects empty payload', async () => {
    await expect(
      service.submitAssignment(lessonId, userId, '   ', []),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when lesson is not found', async () => {
    lessonRepo.exists.mockResolvedValue(false);

    await expect(
      service.submitAssignment(lessonId, userId, 'answer', []),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
