import {
  Index,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Lesson } from '../../lessons/entities/lesson.entity';

export enum SubmissionStatus {
  WAITING = 'WAITING',
  GRADING = 'GRADING',
  PASS = 'PASS',
  FAIL = 'FAIL',
  SUPERSEDED = 'SUPERSEDED',
  FILE_LOST = 'FILE_LOST',
  ARCHIVED = 'ARCHIVED',
}

@Entity('submissions')
@Index('idx_submissions_lesson_id', ['lessonId'])
@Index('idx_submissions_user_id', ['userId'])
@Index('idx_pending_sub', ['userId', 'lessonId'], {
  unique: true,
  where: `"status" = 'WAITING'`,
})
export class Submission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'lesson_id', type: 'uuid' })
  lessonId!: string;

  @ManyToOne(() => Lesson)
  @JoinColumn({ name: 'lesson_id' })
  lesson!: Lesson;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status!: SubmissionStatus;

  @Column({ name: 'version', type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'content_text', type: 'text', nullable: true })
  contentText!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
