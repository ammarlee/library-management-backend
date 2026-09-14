import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateStudyYearDto {
  @ApiProperty({ example: 'Grade 1' })
  @IsString()
  @IsNotEmpty()
  name: string;
}
