import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';
import { SessionStatus } from '../entities/session.entity';

export class UpdateSessionDto {
  @ApiPropertyOptional({
    description: 'Session status',
    enum: SessionStatus,
    example: SessionStatus.READY,
  })
  @IsEnum(SessionStatus)
  @IsOptional()
  status?: SessionStatus;

  @ApiPropertyOptional({
    description: 'Unique name for the session',
    example: 'my-bot',
    minLength: 3,
    maxLength: 50,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9-]+$/, {
    message: 'Session name can only contain letters, numbers, and hyphens',
  })
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'Session configuration options',
  })
  @IsOptional()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Proxy URL for this session',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  proxyUrl?: string;

  @ApiPropertyOptional({
    description: 'Proxy type',
    enum: ['http', 'https', 'socks4', 'socks5'],
  })
  @IsOptional()
  @IsString()
  proxyType?: 'http' | 'https' | 'socks4' | 'socks5';
}
