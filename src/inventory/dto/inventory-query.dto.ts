import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class InventoryQueryDto {
  @ApiPropertyOptional({
    description:
      'When true, only return rows with availableQuantity > 0 and product status not INACTIVE (ACTIVE and UPCOMING included).',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  availableOnly?: boolean;
}
