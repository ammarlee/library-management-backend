import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ChangeReservationProductDto {
  @ApiProperty()
  @IsUUID()
  newProductId: string;
}
