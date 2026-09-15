import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class DeliverReservationDto {
  @ApiPropertyOptional({
    enum: PaymentMethod,
    description: 'Required when there is a remaining balance to collect.',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  proofReference?: string;
}
