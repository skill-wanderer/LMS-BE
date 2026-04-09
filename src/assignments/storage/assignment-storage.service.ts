import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { google, drive_v3 } from 'googleapis';

export interface SubmissionFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface DriveUploadResult {
  driveFileId: string;
  driveUrl: string | null;
  fileName: string;
  fileMimetype: string;
}

interface OrphanDriveCandidate {
  driveFileId: string;
  submissionId: string;
}

interface SubmissionFolderContext {
  submissionId: string;
  version: number;
  username?: string;
  courseSlug?: string;
  lessonSlug?: string;
  lessonId?: string;
}

@Injectable()
export class AssignmentStorageService {
  private driveClient: drive_v3.Drive | null = null;
  private readonly submissionFolderCache = new Map<string, string>();

  constructor(private readonly configService: ConfigService) {}

  async ensureSubmissionFolder(context: SubmissionFolderContext): Promise<string> {
    const cachedFolderId = this.submissionFolderCache.get(context.submissionId);
    if (cachedFolderId) {
      return cachedFolderId;
    }

    const drive = this.getDriveClient();
    const rootFolderId = this.configService.get<string>('submissions.driveFolderId');
    const folderName = this.buildSubmissionFolderName(context);
    const createdFolder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: rootFolderId ? [rootFolderId] : undefined,
        appProperties: {
          submission_id: context.submissionId,
        },
      },
      fields: 'id',
      supportsAllDrives: true,
    });

    const folderId = createdFolder.data.id;
    if (!folderId) {
      throw new InternalServerErrorException('Drive folder creation returned no id');
    }

    this.submissionFolderCache.set(context.submissionId, folderId);
    return folderId;
  }

  async uploadSubmissionFile(
    file: SubmissionFile,
    sanitizedFileName: string,
    submissionId: string,
    parentFolderId?: string,
  ): Promise<DriveUploadResult> {
    const drive = this.getDriveClient();

    const created = await drive.files.create({
      requestBody: {
        name: sanitizedFileName,
        parents: parentFolderId ? [parentFolderId] : undefined,
        appProperties: {
          submission_id: submissionId,
        },
      },
      media: {
        mimeType: file.mimetype,
        body: Readable.from(file.buffer),
      },
      fields: 'id, webViewLink, webContentLink, name, mimeType',
      supportsAllDrives: true,
    });

    const id = created.data.id;
    if (!id) {
      throw new InternalServerErrorException('Drive upload returned no file id');
    }

    return {
      driveFileId: id,
      driveUrl: created.data.webViewLink || created.data.webContentLink || null,
      fileName: created.data.name || sanitizedFileName,
      fileMimetype: created.data.mimeType || file.mimetype,
    };
  }

  async deleteDriveFile(driveFileId: string): Promise<void> {
    const drive = this.getDriveClient();
    await drive.files.delete({
      fileId: driveFileId,
      supportsAllDrives: true,
    });
  }

  async listOrphanCandidates(limit: number): Promise<OrphanDriveCandidate[]> {
    const driveEnabled = this.configService.get<boolean>('submissions.driveEnabled', false);
    if (!driveEnabled) {
      return [];
    }

    const drive = this.getDriveClient();
    const folderId = this.configService.get<string>('submissions.driveFolderId');
    const baseQuery = 'trashed = false';
    const q = folderId ? `${baseQuery} and '${folderId}' in parents` : baseQuery;

    const result = await drive.files.list({
      q,
      pageSize: limit,
      fields: 'files(id, appProperties)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return (result.data.files || [])
      .map((item) => {
        const driveFileId = item.id;
        const submissionId = item.appProperties?.submission_id?.trim();
        if (!driveFileId || !submissionId) {
          return null;
        }

        return {
          driveFileId,
          submissionId,
        };
      })
      .filter((candidate): candidate is OrphanDriveCandidate => candidate !== null);
  }

  private getDriveClient(): drive_v3.Drive {
    if (this.driveClient) {
      return this.driveClient;
    }

    const driveEnabled = this.configService.get<boolean>('submissions.driveEnabled', false);
    if (!driveEnabled) {
      throw new ServiceUnavailableException('Google Drive upload is not enabled');
    }

    const oauthClientId = this.configService.get<string>('submissions.driveOauthClientId');
    const oauthClientSecret = this.configService.get<string>('submissions.driveOauthClientSecret');
    const oauthRefreshToken = this.configService.get<string>('submissions.driveOauthRefreshToken');

    if (!oauthClientId || !oauthClientSecret || !oauthRefreshToken) {
      throw new InternalServerErrorException(
        'Google Drive OAuth credentials are not configured',
      );
    }

    const oauthClient = new google.auth.OAuth2(oauthClientId, oauthClientSecret);
    oauthClient.setCredentials({ refresh_token: oauthRefreshToken });

    this.driveClient = google.drive({ version: 'v3', auth: oauthClient });
    return this.driveClient;
  }

  private buildSubmissionFolderName(context: SubmissionFolderContext): string {
    const modulePart = this.toFolderSafe(`module-${context.courseSlug || 'unknown'}`);
    const lessonBase = context.lessonSlug || context.lessonId || 'unknown';
    const lessonPart = this.toFolderSafe(`lesson-${lessonBase}`).slice(0, 80) || 'lesson-unknown';
    const userPart = this.toFolderSafe(`user-${context.username || 'learner'}`);
    const versionPart = `v${context.version}`;
    return `${modulePart}__${lessonPart}__${userPart}__${versionPart}`;
  }

  private toFolderSafe(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'unknown';
  }
}
