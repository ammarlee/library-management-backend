import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsPositive,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class ReturnItemDto {
  @ApiProperty()
  @IsUUID()
  saleItemId: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity: number;
}

export class CreateReturnDto {
  @ApiProperty()
  @IsUUID()
  saleId: string;

  @ApiProperty({ type: [ReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;
}
