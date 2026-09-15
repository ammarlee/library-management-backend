import { ApiPropertyOptional } from '@nestjs/swagger';
import { TeacherStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class TeacherQueryDto {
  @ApiPropertyOptional({ description: 'Search by teacher name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: TeacherStatus })
  @IsOptional()
  @IsEnum(TeacherStatus)
  status?: TeacherStatus;
}
