import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateAcademicYearDto {
  @ApiProperty({ example: '2025/2026' })
  @IsString()
  @IsNotEmpty()
  name: string;
}
