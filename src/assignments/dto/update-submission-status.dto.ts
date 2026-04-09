import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { SubmissionStatus } from '../entities/assignment-submission.entity';

export enum AdminSubmissionStatus {
  GRADING = SubmissionStatus.GRADING,
  PASS = SubmissionStatus.PASS,
  FAIL = SubmissionStatus.FAIL,
}

export class UpdateSubmissionStatusDto {
  @ApiProperty({ enum: AdminSubmissionStatus })
  @IsEnum(AdminSubmissionStatus)
  status!: AdminSubmissionStatus;
}
