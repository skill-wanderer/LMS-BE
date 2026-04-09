import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SubmitAssignmentDto {
  @ApiPropertyOptional({
    description: 'Optional plain text answer for the submission',
    maxLength: 10000,
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
  @MaxLength(10000)
  contentText?: string;

  @ApiPropertyOptional({
    description: 'Optional expected number of uploaded files',
    minimum: 0,
    maximum: 10,
    example: 2,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined && value !== '' ? Number(value) : undefined))
  @IsInt()
  @Min(0)
  @Max(10)
  fileCount?: number;
}
