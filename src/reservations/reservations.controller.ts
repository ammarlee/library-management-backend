import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ChangeReservationProductDto } from './dto/change-reservation-product.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { DeliverReservationDto } from './dto/deliver-reservation.dto';
import { ReservationsService } from './reservations.service';

@ApiTags('reservations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @Roles(UserRole.CUSTOMER_SERVICE, UserRole.BRANCH_EMPLOYEE)
  create(
    @Body() dto: CreateReservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reservationsService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER_SERVICE, UserRole.BRANCH_EMPLOYEE)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.reservationsService.findAll(user);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER_SERVICE, UserRole.BRANCH_EMPLOYEE)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reservationsService.findOne(id, user);
  }

  @Post(':id/deliver')
  @Roles(UserRole.BRANCH_EMPLOYEE)
  deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliverReservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reservationsService.deliver(id, dto, user);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reservationsService.cancel(id, user);
  }

  @Post(':id/change-product')
  @Roles(UserRole.ADMIN)
  changeProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeReservationProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reservationsService.changeProduct(id, dto, user);
  }
}
