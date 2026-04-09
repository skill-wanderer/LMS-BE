import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  ParseUUIDPipe,
  Post,
  Param,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AssignmentsService } from './assignments.service';
import { SubmitAssignmentDto } from './dto/submit-assignment.dto';
import { SubmissionStatus } from './entities/assignment-submission.entity';
import {
  AssignmentSubmissionResponseDto,
  AssignmentSubmissionStateDto,
} from './dto/assignment-submission-response.dto';
import { UpdateSubmissionStatusDto } from './dto/update-submission-status.dto';

@ApiTags('Lesson Submissions')
@ApiBearerAuth('keycloak')
@Controller()
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Patch('submissions/:submissionId/status')
  @Roles('admin')
  @ApiOperation({
    summary: 'Update a submission status for grading workflow',
  })
  @ApiParam({ name: 'submissionId', description: 'Submission ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Submission status updated',
    type: AssignmentSubmissionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  async updateSubmissionStatus(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @CurrentUser('id') actorId: string,
    @Body() body: UpdateSubmissionStatusDto,
  ): Promise<AssignmentSubmissionResponseDto> {
    return this.assignmentsService.updateSubmissionStatus(
      submissionId,
      body.status as unknown as SubmissionStatus,
      actorId,
    );
  }

  @Get('courses/:courseSlug/lessons/:lessonSlug/submissions/state')
  @ApiOperation({
    summary: 'Get current submission state for a lesson',
  })
  @ApiParam({ name: 'courseSlug', description: 'Course slug' })
  @ApiParam({ name: 'lessonSlug', description: 'Lesson slug' })
  @ApiResponse({
    status: 200,
    description: 'Current lesson submission state',
    type: AssignmentSubmissionStateDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Course or lesson not found' })
  async getSubmissionStateBySlugs(
    @Param('courseSlug') courseSlug: string,
    @Param('lessonSlug') lessonSlug: string,
    @CurrentUser('id') userId: string,
  ): Promise<AssignmentSubmissionStateDto> {
    return this.assignmentsService.getSubmissionStateBySlugs(
      courseSlug,
      lessonSlug,
      userId,
    );
  }

  @Post('lessons/:lessonId/submissions')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
    }),
  )
  @ApiOperation({
    summary: 'Submit lesson answer with optional text and multiple files',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'lessonId', description: 'Lesson ID (UUID)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        contentText: {
          type: 'string',
          description: 'Optional plain text answer',
        },
        fileCount: {
          type: 'integer',
          minimum: 0,
          description: 'Optional expected file count for integrity check',
        },
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          description: 'Optional file uploads (max 10 files)',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Submission created',
    type: AssignmentSubmissionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (already passed)' })
  @ApiResponse({ status: 404, description: 'Lesson not found' })
  @ApiResponse({ status: 429, description: 'Rate limited or lesson submission is pending/grading' })
  @ApiResponse({ status: 413, description: 'File is too large' })
  @ApiResponse({ status: 415, description: 'Unsupported file type' })
  async submitAssignmentByLessonId(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('username') username: string,
    @Body() body: SubmitAssignmentDto = {},
    @UploadedFiles() files: Express.Multer.File[] = [],
  ): Promise<AssignmentSubmissionResponseDto> {
    this.validatePayload(body, files);

    return this.assignmentsService.submitAssignment(
      lessonId,
      userId,
      body.contentText,
      files,
      body.fileCount,
      username,
    );
  }

  @Post('courses/:courseSlug/lessons/:lessonSlug/submissions')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
    }),
  )
  @ApiOperation({
    summary: 'Submit lesson answer by course slug and lesson slug',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'courseSlug', description: 'Course slug' })
  @ApiParam({ name: 'lessonSlug', description: 'Lesson slug' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        contentText: {
          type: 'string',
          description: 'Optional plain text answer',
        },
        fileCount: {
          type: 'integer',
          minimum: 0,
          description: 'Optional expected file count for integrity check',
        },
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          description: 'Optional file uploads (max 10 files)',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Submission created',
    type: AssignmentSubmissionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (already passed)' })
  @ApiResponse({ status: 404, description: 'Course or lesson not found' })
  @ApiResponse({ status: 429, description: 'Rate limited or lesson is waiting/grading' })
  @ApiResponse({ status: 413, description: 'File is too large' })
  @ApiResponse({ status: 415, description: 'Unsupported file type' })
  async submitAssignmentBySlugs(
    @Param('courseSlug') courseSlug: string,
    @Param('lessonSlug') lessonSlug: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('username') username: string,
    @Body() body: SubmitAssignmentDto = {},
    @UploadedFiles() files: Express.Multer.File[] = [],
  ): Promise<AssignmentSubmissionResponseDto> {
    this.validatePayload(body, files);

    return this.assignmentsService.submitAssignmentBySlugs(
      courseSlug,
      lessonSlug,
      userId,
      body.contentText,
      files,
      body.fileCount,
      username,
    );
  }

  private validatePayload(
    body: SubmitAssignmentDto,
    files: Express.Multer.File[] = [],
  ): void {
    const hasText = Boolean(body.contentText?.trim());
    const uploadedFiles = files || [];

    if (!hasText && uploadedFiles.length === 0) {
      throw new BadRequestException(
        'Either contentText or files must be provided',
      );
    }
  }
}

