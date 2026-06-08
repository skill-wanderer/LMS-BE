import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

@Catch(MulterError)
export class SubmissionUploadExceptionFilter implements ExceptionFilter<MulterError> {
  catch(exception: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mappedException = this.mapException(exception);
    const status = mappedException.getStatus();
    const payload = mappedException.getResponse();

    response.status(status).json(
      typeof payload === 'string'
        ? {
          statusCode: status,
          message: payload,
          error: mappedException.name,
        }
        : payload,
    );
  }

  private mapException(exception: MulterError): BadRequestException | PayloadTooLargeException {
    switch (exception.code) {
      case 'LIMIT_FILE_SIZE':
        return new PayloadTooLargeException('Each uploaded file must be 10MB or smaller');
      case 'LIMIT_FILE_COUNT':
        return new BadRequestException('File count exceeds limit (10)');
      case 'LIMIT_UNEXPECTED_FILE':
        return new BadRequestException('Invalid upload field. Use "files" for attachments');
      default:
        return new BadRequestException('Invalid submission upload payload');
    }
  }
}
