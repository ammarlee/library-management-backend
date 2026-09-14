import { ApiProperty } from '@nestjs/swagger';
import { TeacherStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateTeacherStatusDto {
  @ApiProperty({ enum: TeacherStatus })
  @IsEnum(TeacherStatus)
  status: TeacherStatus;
}
