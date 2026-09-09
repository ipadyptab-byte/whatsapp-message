import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { MessageService } from './message.service';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { MessageResponseDto } from './dto';

@ApiTags('messages')
@Controller('send')
export class QuickSendController {
  constructor(private readonly messageService: MessageService) {}

  @Get()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Quick-send a text message via simple browser URL' })
  @ApiQuery({ name: 'session', required: false, description: 'Session ID/name (defaults to "default")' })
  @ApiQuery({ name: 'sessionId', required: false, description: 'Alternative for session' })
  @ApiQuery({ name: 'phone', required: false, description: 'Recipient phone number (e.g. 919422039371)' })
  @ApiQuery({ name: 'chatId', required: false, description: 'Chat ID (e.g. 919422039371@c.us)' })
  @ApiQuery({ name: 'text', required: false, description: 'Message content' })
  @ApiQuery({ name: 'message', required: false, description: 'Alternative for text' })
  @ApiQuery({ name: 'apiKey', required: false, description: 'API Key (if not provided in headers)' })
  @ApiResponse({
    status: 200,
    description: 'Message sent successfully',
    type: MessageResponseDto,
  })
  async send(
    @Query('session') session?: string,
    @Query('sessionId') sessionIdParam?: string,
    @Query('phone') phone?: string,
    @Query('chatId') chatId?: string,
    @Query('text') text?: string,
    @Query('message') message?: string,
  ): Promise<MessageResponseDto> {
    const sessionId = (session || sessionIdParam || 'default').trim();
    const rawNumber = (phone || chatId || '').trim();
    let targetChatId = '';
    if (rawNumber.includes('@')) {
      targetChatId = rawNumber;
    } else if (rawNumber) {
      targetChatId = `${rawNumber.replace(/[^0-9]/g, '')}@c.us`;
    }

    const messageContent = text ?? message ?? '';

    if (!targetChatId) {
      throw new BadRequestException('Query parameter "phone" or "chatId" is required (e.g. ?phone=919422039371)');
    }
    if (!messageContent) {
      throw new BadRequestException('Query parameter "text" or "message" is required (e.g. ?text=Hi)');
    }

    return this.messageService.sendText(sessionId, {
      chatId: targetChatId,
      text: messageContent,
    });
  }
}
