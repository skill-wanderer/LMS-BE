import { ApiProperty } from '@nestjs/swagger';

export class SubmissionConstraintsDto {
  @ApiProperty({ minimum: 1 })
  maxContentLength!: number;

  @ApiProperty({ minimum: 1 })
  maxFiles!: number;

  @ApiProperty({ minimum: 1 })
  maxFileSizeMb!: number;

  @ApiProperty({ type: [String] })
  allowedMimeTypes!: string[];
}
