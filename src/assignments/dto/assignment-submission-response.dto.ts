import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubmissionStatus } from '../entities/assignment-submission.entity';

export enum SubmissionStateStatus {
  ACTIVE = 'ACTIVE',
  WAITING = 'WAITING',
  GRADING = 'GRADING',
  PASS = 'PASS',
  FAIL = 'FAIL',
}

export class SubmissionFileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: 500 })
  fileName!: string;

  @ApiProperty({ maxLength: 255 })
  fileMimetype!: string;

  @ApiPropertyOptional({ nullable: true })
  driveFileId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  driveUrl!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class AssignmentSubmissionResponseDto {
  @ApiProperty({ format: 'uuid' })
  submissionId!: string;

  @ApiProperty({ format: 'uuid' })
  lessonId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: SubmissionStatus })
  status!: SubmissionStatus;

  @ApiProperty({
    description: 'Whether learner can create another submission immediately after this response state',
  })
  canSubmit!: boolean;

  @ApiProperty()
  version!: number;

  @ApiPropertyOptional({ nullable: true })
  contentText!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: [SubmissionFileResponseDto] })
  files!: SubmissionFileResponseDto[];
}

export class AssignmentSubmissionStateDto {
  @ApiProperty({ enum: SubmissionStateStatus })
  status!: SubmissionStateStatus;

  @ApiProperty()
  canSubmit!: boolean;

  @ApiPropertyOptional({ type: () => AssignmentSubmissionResponseDto, nullable: true })
  latestSubmission!: AssignmentSubmissionResponseDto | null;
}
