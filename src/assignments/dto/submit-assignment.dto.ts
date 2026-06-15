import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { getSubmissionSettingsFromEnv } from '../../config/submissions.config';

const dtoSubmissionLimits = getSubmissionSettingsFromEnv();

export class SubmitAssignmentDto {
  @ApiPropertyOptional({
    description: 'Optional plain text answer for the submission',
    maxLength: dtoSubmissionLimits.maxContentLength,
    example: 'My assignment answer in plain text.',
  })
  @IsOptional()
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    if (typeof value === 'string') {
      return value;
    }

    const alias = obj?.contentText ?? obj?.content ?? obj?.text;
    return typeof alias === 'string' ? alias : value;
  })
  @IsString()
  @MaxLength(dtoSubmissionLimits.maxContentLength)
  contentText?: string;

  @ApiPropertyOptional({
    description: 'Optional expected number of uploaded files',
    minimum: 0,
    maximum: dtoSubmissionLimits.maxFiles,
    example: 2,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined && value !== '' ? Number(value) : undefined))
  @IsInt()
  @Min(0)
  @Max(dtoSubmissionLimits.maxFiles)
  fileCount?: number;
}
