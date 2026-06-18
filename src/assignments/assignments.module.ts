import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { Submission } from './entities/assignment-submission.entity';
import { AssignmentStorageService } from './storage/assignment-storage.service';
import { SubmissionFileEntity } from './entities/submission-file.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { Course } from '../courses/entities/course.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Course, Lesson, Submission, SubmissionFileEntity]),
  ],
  controllers: [AssignmentsController],
  providers: [AssignmentsService, AssignmentStorageService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
