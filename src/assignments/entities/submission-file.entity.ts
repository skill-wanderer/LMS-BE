import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Submission } from './assignment-submission.entity';
import { submissionDefaults } from '../../config/submissions.config';

@Entity('submission_files')
@Index('idx_submission_files_submission_id', ['submissionId'])
@Index('ux_submission_files_drive_file_id', ['driveFileId'], {
  unique: true,
  where: 'drive_file_id IS NOT NULL',
})
export class SubmissionFileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId!: string;

  @ManyToOne(() => Submission)
  @JoinColumn({ name: 'submission_id' })
  submission!: Submission;

  @Column({
    name: 'file_name',
    type: 'varchar',
    length: submissionDefaults.fileNameMaxLength,
  })
  fileName!: string;

  @Column({
    name: 'file_mimetype',
    type: 'varchar',
    length: submissionDefaults.fileMimetypeMaxLength,
  })
  fileMimetype!: string;

  @Column({
    name: 'drive_file_id',
    type: 'varchar',
    length: submissionDefaults.driveFileIdMaxLength,
    nullable: true,
  })
  driveFileId!: string | null;

  @Column({ name: 'drive_url', type: 'text', nullable: true })
  driveUrl!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
