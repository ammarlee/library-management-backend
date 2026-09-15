import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class UploadsService {
  constructor(
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  uploadPaymentScreenshot(file: Express.Multer.File) {
    return this.storageService.uploadPaymentScreenshot(file);
  }

  async getSignedPaymentScreenshot(
    paymentId: string,
    user: AuthenticatedUser,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        sale: { select: { branchId: true, createdById: true } },
        reservation: {
          select: { branchId: true, createdById: true },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (!payment.proofReference) {
      throw new NotFoundException('Payment screenshot not found');
    }

    this.assertCanViewPayment(payment, user);

    const key = payment.proofReference;
    const file_url = await this.storageService.getSignedUrl(key);

    return {
      file_url,
      mime_type: this.storageService.guessMimeTypeFromKey(key),
      key,
    };
  }

  private assertCanViewPayment(
    payment: {
      createdById: string;
      sale: { branchId: string; createdById: string } | null;
      reservation: { branchId: string; createdById: string } | null;
    },
    user: AuthenticatedUser,
  ) {
    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (user.role === UserRole.CUSTOMER_SERVICE) {
      const allowed =
        payment.createdById === user.id ||
        payment.reservation?.createdById === user.id;
      if (!allowed) {
        throw new ForbiddenException(
          'Cannot view this payment screenshot',
        );
      }
      return;
    }

    if (user.role === UserRole.BRANCH_EMPLOYEE) {
      if (!user.branchId) {
        throw new ForbiddenException(
          'Cannot view this payment screenshot',
        );
      }

      const branchId =
        payment.sale?.branchId || payment.reservation?.branchId;
      if (branchId !== user.branchId) {
        throw new ForbiddenException(
          'Cannot view this payment screenshot',
        );
      }
      return;
    }

    throw new ForbiddenException('Cannot view this payment screenshot');
  }
}
