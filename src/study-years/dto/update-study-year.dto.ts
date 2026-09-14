import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateStudyYearDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;
}
