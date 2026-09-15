import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { getPaymentScreenshotMaxBytes } from '../config/storage.config';
import { UploadsService } from './uploads.service';

@ApiTags('uploads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('payment-screenshot')
  @Roles(
    UserRole.ADMIN,
    UserRole.CUSTOMER_SERVICE,
    UserRole.BRANCH_EMPLOYEE,
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: getPaymentScreenshotMaxBytes(),
      },
    }),
  )
  uploadPaymentScreenshot(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.uploadsService.uploadPaymentScreenshot(file);
  }

  @Get('payment-screenshot/:paymentId')
  @Roles(
    UserRole.ADMIN,
    UserRole.CUSTOMER_SERVICE,
    UserRole.BRANCH_EMPLOYEE,
  )
  getPaymentScreenshot(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploadsService.getSignedPaymentScreenshot(paymentId, user);
  }
}
