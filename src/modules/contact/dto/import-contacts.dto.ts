import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ContactDto {
  @ApiProperty({ description: 'Phone number (with country code)', example: '6281234567890' })
  @IsString()
  number: string;

  @ApiProperty({ description: 'Contact name', example: 'John Doe', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: 'Additional notes', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ImportContactsDto {
  @ApiProperty({ type: [ContactDto], description: 'Array of contacts to import' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts: ContactDto[];
}

export class ContactResponseDto {
  @ApiProperty()
  number: string;

  @ApiProperty({ required: false })
  name?: string;

  @ApiProperty({ required: false })
  notes?: string;

  @ApiProperty()
  imported: boolean;

  @ApiProperty({ required: false })
  error?: string;
}