import { ApiProperty } from '@nestjs/swagger';
import { BranchStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateBranchStatusDto {
  @ApiProperty({ enum: BranchStatus })
  @IsEnum(BranchStatus)
  status: BranchStatus;
}
