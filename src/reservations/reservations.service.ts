import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BranchStatus,
  PaymentMethod,
  ProductStatus,
  ReservationStatus,
  StudentStatus,
  UserRole,
} from '@prisma/client';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import {
  isPositive,
  multiplyDecimal,
  toDecimal,
} from '../common/utils/decimal.util';
import { generateReservationNumber } from '../common/utils/reservation-number.util';
import { InventoryOperationsService } from '../inventory/inventory-operations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeReservationProductDto } from './dto/change-reservation-product.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { DeliverReservationDto } from './dto/deliver-reservation.dto';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryOps: InventoryOperationsService,
  ) {}

  async findAll(user: AuthenticatedUser) {
    const where = this.buildListFilter(user);

    return this.prisma.reservation.findMany({
      where,
      include: this.reservationIncludes(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: this.reservationIncludes(),
    });

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    this.assertCanView(reservation, user);
    return reservation;
  }

  async create(dto: CreateReservationDto, user: AuthenticatedUser) {
    const branchId = this.resolveBranchId(dto.branchId, user);
    const deposit = toDecimal(dto.deposit);

    if (!isPositive(deposit)) {
      throw new BadRequestException('Deposit must be greater than zero');
    }

    const [student, branch, product] = await Promise.all([
      this.prisma.student.findFirst({
        where: { id: dto.studentId, deletedAt: null },
      }),
      this.prisma.branch.findUnique({ where: { id: branchId } }),
      this.prisma.product.findUnique({ where: { id: dto.productId } }),
    ]);

    if (!student || student.status !== StudentStatus.ACTIVE) {
      throw new BadRequestException('Student not found or inactive');
    }

    if (!branch || branch.status !== BranchStatus.ACTIVE) {
      throw new BadRequestException('Branch not found or inactive');
    }

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (!product.reservationAllowed) {
      throw new BadRequestException('Product is not reservable');
    }

    const reservationPrice = this.resolveProductUnitPrice(product);
    const totalAmount = multiplyDecimal(reservationPrice, dto.quantity);

    if (deposit.gt(totalAmount)) {
      throw new BadRequestException(
        'Deposit cannot exceed product/reservation price',
      );
    }

    const reservationId = await this.prisma.$transaction(
      async (tx) => {
        const inventory = await tx.inventory.findUnique({
          where: {
            branchId_productId: { branchId, productId: dto.productId },
          },
        });

        const available = inventory
          ? this.inventoryOps.getAvailableQuantity(inventory)
          : 0;

        const status =
          available >= dto.quantity
            ? ReservationStatus.READY
            : ReservationStatus.WAITING_FOR_STOCK;

        const reservation = await tx.reservation.create({
          data: {
            reservationNumber: await generateReservationNumber(tx),
            studentId: dto.studentId,
            branchId,
            productId: dto.productId,
            createdById: user.id,
            quantity: dto.quantity,
            reservationPrice,
            totalAmount,
            paidAmount: deposit,
            status,
          },
        });

        if (status === ReservationStatus.READY) {
          await this.inventoryOps.reserveStock(tx, {
            branchId,
            productId: dto.productId,
            quantity: dto.quantity,
            createdById: user.id,
            referenceId: reservation.id,
          });
        }

        await tx.payment.create({
          data: {
            reservationId: reservation.id,
            amount: deposit,
            method: dto.method,
            proofReference: dto.proofReference,
            createdById: user.id,
          },
        });

        return reservation.id;
      },
      { maxWait: 10_000, timeout: 20_000 },
    );

    return this.prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
      include: this.reservationIncludes(),
    });
  }

  async deliver(id: string, dto: DeliverReservationDto, user: AuthenticatedUser) {
    if (user.role !== UserRole.BRANCH_EMPLOYEE || !user.branchId) {
      throw new ForbiddenException('Only branch employees can deliver reservations');
    }

    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { product: true },
    });

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (reservation.branchId !== user.branchId) {
      throw new ForbiddenException('Reservation belongs to another branch');
    }

    if (reservation.status !== ReservationStatus.READY) {
      throw new BadRequestException('Reservation is not ready for delivery');
    }

    const remaining = reservation.totalAmount.sub(reservation.paidAmount);
    const hasRemaining = remaining.gt(0);

    if (hasRemaining) {
      if (!dto.method) {
        throw new BadRequestException(
          'Payment method is required to collect the remaining balance',
        );
      }

      if (
        (dto.method === PaymentMethod.WALLET ||
          dto.method === PaymentMethod.INSTAPAY) &&
        !dto.proofReference?.trim()
      ) {
        throw new BadRequestException(
          'Payment proof is required for wallet/Instapay remaining payment',
        );
      }
    }

    const sale = await this.prisma.$transaction(
      async (tx) => {
        const createdSale = await tx.sale.create({
          data: {
            studentId: reservation.studentId,
            branchId: reservation.branchId,
            createdById: user.id,
            totalAmount: reservation.totalAmount,
            reservationId: reservation.id,
            items: {
              create: {
                productId: reservation.productId,
                quantity: reservation.quantity,
                unitPrice: reservation.reservationPrice,
                unitCost: reservation.product.purchasePrice,
                total: reservation.totalAmount,
              },
            },
            payments: hasRemaining
              ? {
                  create: {
                    amount: remaining,
                    method: dto.method!,
                    proofReference: dto.proofReference,
                    createdById: user.id,
                  },
                }
              : undefined,
          },
          include: {
            items: true,
            payments: true,
          },
        });

        await this.inventoryOps.sellStock(tx, {
          branchId: reservation.branchId,
          productId: reservation.productId,
          quantity: reservation.quantity,
          createdById: user.id,
          referenceId: createdSale.id,
          fromReservation: true,
        });

        await tx.reservation.update({
          where: { id },
          data: {
            status: ReservationStatus.DELIVERED,
            paidAmount: reservation.totalAmount,
          },
        });

        return createdSale;
      },
      { maxWait: 10_000, timeout: 20_000 },
    );

    const updatedReservation = await this.prisma.reservation.findUniqueOrThrow({
      where: { id },
      include: this.reservationIncludes(),
    });

    return { reservation: updatedReservation, sale };
  }

  async cancel(id: string, user: AuthenticatedUser) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
    });

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (
      reservation.status === ReservationStatus.DELIVERED ||
      reservation.status === ReservationStatus.CANCELLED
    ) {
      throw new BadRequestException('Reservation cannot be cancelled');
    }

    const hadReservedStock =
      reservation.status === ReservationStatus.READY ||
      reservation.status === ReservationStatus.PENDING;

    return this.prisma.$transaction(
      async (tx) => {
      if (hadReservedStock) {
        const inventory = await tx.inventory.findUnique({
          where: {
            branchId_productId: {
              branchId: reservation.branchId,
              productId: reservation.productId,
            },
          },
        });

        if (
          inventory &&
          inventory.reservedQuantity >= reservation.quantity &&
          reservation.status === ReservationStatus.READY
        ) {
          await this.inventoryOps.releaseReservedStock(tx, {
            branchId: reservation.branchId,
            productId: reservation.productId,
            quantity: reservation.quantity,
            createdById: user.id,
            referenceId: reservation.id,
          });
        }
      }

      if (reservation.paidAmount.gt(0)) {
        await tx.refund.create({
          data: {
            reservationId: reservation.id,
            amount: reservation.paidAmount,
            method: PaymentMethod.CASH,
            createdById: user.id,
          },
        });
      }

      return tx.reservation.update({
        where: { id },
        data: { status: ReservationStatus.CANCELLED },
        include: this.reservationIncludes(),
      });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  async changeProduct(
    id: string,
    dto: ChangeReservationProductDto,
    user: AuthenticatedUser,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { product: true },
    });

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (
      reservation.status === ReservationStatus.DELIVERED ||
      reservation.status === ReservationStatus.CANCELLED
    ) {
      throw new BadRequestException('Reservation cannot be modified');
    }

    const newProduct = await this.prisma.product.findUnique({
      where: { id: dto.newProductId },
    });

    if (!newProduct || !newProduct.reservationAllowed) {
      throw new BadRequestException('New product is not reservable');
    }

    return this.prisma.$transaction(
      async (tx) => {
      if (reservation.status === ReservationStatus.READY) {
        await this.inventoryOps.releaseReservedStock(tx, {
          branchId: reservation.branchId,
          productId: reservation.productId,
          quantity: reservation.quantity,
          createdById: user.id,
          referenceId: reservation.id,
        });
      }

      const reservationPrice = this.resolveProductUnitPrice(newProduct);
      const totalAmount = multiplyDecimal(
        reservationPrice,
        reservation.quantity,
      );

      let status: ReservationStatus = ReservationStatus.WAITING_FOR_STOCK;

      const inventory = await tx.inventory.findUnique({
        where: {
          branchId_productId: {
            branchId: reservation.branchId,
            productId: dto.newProductId,
          },
        },
      });

      const available = inventory
        ? this.inventoryOps.getAvailableQuantity(inventory)
        : 0;

      if (available >= reservation.quantity) {
        await this.inventoryOps.ensureInventory(
          tx,
          reservation.branchId,
          dto.newProductId,
        );
        await this.inventoryOps.reserveStock(tx, {
          branchId: reservation.branchId,
          productId: dto.newProductId,
          quantity: reservation.quantity,
          createdById: user.id,
          referenceId: reservation.id,
        });
        status = ReservationStatus.READY;
      }

      let paidAmount = reservation.paidAmount;

      if (paidAmount.gt(totalAmount)) {
        const refundAmount = paidAmount.sub(totalAmount);
        await tx.refund.create({
          data: {
            reservationId: reservation.id,
            amount: refundAmount,
            method: PaymentMethod.CASH,
            createdById: user.id,
          },
        });
        paidAmount = totalAmount;
      }

      return tx.reservation.update({
        where: { id },
        data: {
          productId: dto.newProductId,
          reservationPrice,
          totalAmount,
          paidAmount,
          status,
        },
        include: this.reservationIncludes(),
      });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  private resolveBranchId(
    requestedBranchId: string | undefined,
    user: AuthenticatedUser,
  ) {
    if (user.role === UserRole.BRANCH_EMPLOYEE) {
      if (!user.branchId) {
        throw new ForbiddenException('Branch employee has no branch assigned');
      }
      if (requestedBranchId && requestedBranchId !== user.branchId) {
        throw new ForbiddenException('Cannot create reservation for another branch');
      }
      return user.branchId;
    }

    if (!requestedBranchId) {
      throw new BadRequestException('Branch is required');
    }

    return requestedBranchId;
  }

  private buildListFilter(user: AuthenticatedUser) {
    if (user.role === UserRole.ADMIN) {
      return {};
    }

    if (user.role === UserRole.CUSTOMER_SERVICE) {
      return { createdById: user.id };
    }

    if (user.role === UserRole.BRANCH_EMPLOYEE && user.branchId) {
      return { branchId: user.branchId };
    }

    return { id: 'none' };
  }

  private assertCanView(
    reservation: { branchId: string; createdById: string },
    user: AuthenticatedUser,
  ) {
    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (
      user.role === UserRole.CUSTOMER_SERVICE &&
      reservation.createdById === user.id
    ) {
      return;
    }

    if (
      user.role === UserRole.BRANCH_EMPLOYEE &&
      user.branchId === reservation.branchId
    ) {
      return;
    }

    throw new ForbiddenException('Cannot view this reservation');
  }

  /**
   * Prefer selling price when set; otherwise use reservation/initial price.
   * Matches the booking UI display + deposit cap.
   */
  private resolveProductUnitPrice(product: {
    sellingPrice: { gt?: (n: number) => boolean } | number | string;
    reservationPrice: { gt?: (n: number) => boolean } | number | string | null;
  }) {
    const selling = toDecimal(product.sellingPrice as number | string);
    if (isPositive(selling)) {
      return selling;
    }

    if (product.reservationPrice != null) {
      return toDecimal(product.reservationPrice as number | string);
    }

    return selling;
  }

  private reservationIncludes() {
    return {
      student: true,
      branch: true,
      product: {
        include: {
          teacher: true,
          studyYear: true,
          academicYear: true,
        },
      },
      createdBy: {
        select: { id: true, fullName: true, email: true },
      },
      payments: true,
      refunds: true,
      sale: true,
    };
  }
}
