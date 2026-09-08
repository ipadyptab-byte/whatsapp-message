import { Controller, Post, Get, Headers, HttpCode, HttpStatus, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { createLogger } from '../../common/services/logger.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Public } from './decorators/auth.decorators';

@ApiTags('auth')
@Controller('auth')
export class AuthValidateController {
  private readonly logger = createLogger('AuthValidateController');

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('current-key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the persistent default API key for seamless dashboard access' })
  @ApiResponse({ status: 200, description: 'Current admin API key' })
  async getCurrentKey(): Promise<{ apiKey: string; role: string }> {
    return this.authService.getCurrentAdminKey();
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with username and password to get API key' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid username or password' })
  async login(@Body() loginDto: LoginDto): Promise<{ apiKey: string; role: string }> {
    return this.authService.loginUser(loginDto);
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'Registration successful' })
  @ApiResponse({ status: 409, description: 'Username already exists' })
  async register(@Body() registerDto: RegisterDto): Promise<{ message: string }> {
    await this.authService.registerUser(registerDto);
    return { message: 'Registration successful' };
  }

  @Public()
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate an API key' })
  @ApiHeader({ name: 'X-API-Key', description: 'API key to validate' })
  @ApiResponse({ status: 200, description: 'API key is valid' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async validate(@Headers('x-api-key') apiKey?: string): Promise<{ valid: boolean; role?: string }> {
    if (!apiKey) {
      return { valid: false };
    }

    try {
      const keyEntity = await this.authService.validateApiKey(apiKey);
      if (keyEntity && keyEntity.isActive) {
        return { valid: true, role: keyEntity.role };
      }
      return { valid: false };
    } catch (error) {
      this.logger.warn('API key validation error', { error: error instanceof Error ? error.message : String(error) });
      return { valid: false };
    }
  }
}
