import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('contacts')
export class Contact {
  @PrimaryColumn()
  id: string;

  @Column()
  sessionId: string;

  @Column({ unique: true })
  number: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true, type: 'text' })
  notes: string;

  @Column({ default: false })
  isWhatsAppUser: boolean;

  @Column({ nullable: true })
  profilePictureUrl: string;

  @Column({ nullable: true })
  lastMessageAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}