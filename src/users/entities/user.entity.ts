import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { userDefaults } from '../../config/users.config';

@Entity('users')
@Unique(['username'])
export class User {
  @PrimaryColumn({ type: 'varchar', length: userDefaults.idMaxLength })
  id: string;

  @Column({ type: 'varchar', length: userDefaults.usernameMaxLength })
  username: string;

  @Column({ type: 'varchar', length: userDefaults.emailMaxLength })
  email: string;

  @Column({
    name: 'first_name',
    type: 'varchar',
    length: userDefaults.firstNameMaxLength,
    nullable: true,
  })
  firstName?: string;

  @Column({
    name: 'last_name',
    type: 'varchar',
    length: userDefaults.lastNameMaxLength,
    nullable: true,
  })
  lastName?: string;

  @Column({ name: 'last_activity_at', type: 'timestamp', nullable: true })
  lastActivityAt?: Date;

  @Column({
    name: 'last_action_name',
    type: 'varchar',
    length: userDefaults.actionNameMaxLength,
    nullable: true,
  })
  lastActionName?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
