import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SaleStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { multiplyDecimal } from '../common/utils/decimal.util';
import { InventoryOperationsService } from '../inventory/inventory-operations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReturnDto } from './dto/create-return.dto';

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryOps: InventoryOperationsService,
  ) {}

  findAll() {
    return this.prisma.productReturn.findMany({
      include: this.returnIncludes(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const returnRecord = await this.prisma.productReturn.findUnique({
      where: { id },
      include: this.returnIncludes(),
    });

    if (!returnRecord) {
      throw new NotFoundException('Return not found');
    }

    return returnRecord;
  }

  async create(dto: CreateReturnDto, user: AuthenticatedUser) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: dto.saleId },
      include: { items: true },
    });

    if (!sale) {
      throw new NotFoundException('Sale not found');
    }

    if (sale.status === SaleStatus.RETURNED) {
      throw new BadRequestException('Sale is already fully returned');
    }

    const saleItemsMap = new Map(sale.items.map((item) => [item.id, item]));
    let totalRefund = new Decimal(0);
    const returnItemsData: Array<{
      saleItemId: string;
      quantity: number;
      refundAmount: Decimal;
      productId: string;
    }> = [];

    for (const item of dto.items) {
      const saleItem = saleItemsMap.get(item.saleItemId);
      if (!saleItem) {
        throw new BadRequestException('Invalid sale item');
      }

      const remaining = saleItem.quantity - saleItem.returnedQuantity;
      if (item.quantity > remaining) {
        throw new BadRequestException('Return quantity exceeds remaining quantity');
      }

      const refundAmount = multiplyDecimal(saleItem.unitPrice, item.quantity);
      totalRefund = totalRefund.add(refundAmount);

      returnItemsData.push({
        saleItemId: item.saleItemId,
        quantity: item.quantity,
        refundAmount,
        productId: saleItem.productId,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const returnRecord = await tx.productReturn.create({
        data: {
          saleId: sale.id,
          createdById: user.id,
          totalRefundAmount: totalRefund,
          items: {
            create: returnItemsData.map((item) => ({
              saleItemId: item.saleItemId,
              quantity: item.quantity,
              refundAmount: item.refundAmount,
            })),
          },
        },
      });

      await tx.refund.create({
        data: {
          saleId: sale.id,
          returnId: returnRecord.id,
          amount: totalRefund,
          method: dto.method,
          createdById: user.id,
        },
      });

      for (const item of returnItemsData) {
        await this.inventoryOps.returnStock(tx, {
          branchId: sale.branchId,
          productId: item.productId,
          quantity: item.quantity,
          createdById: user.id,
          referenceId: returnRecord.id,
        });

        const saleItem = saleItemsMap.get(item.saleItemId)!;
        await tx.saleItem.update({
          where: { id: item.saleItemId },
          data: {
            returnedQuantity: saleItem.returnedQuantity + item.quantity,
          },
        });
      }

      const updatedItems = await tx.saleItem.findMany({
        where: { saleId: sale.id },
      });

      const allReturned = updatedItems.every(
        (item) => item.returnedQuantity >= item.quantity,
      );
      const anyReturned = updatedItems.some((item) => item.returnedQuantity > 0);

      await tx.sale.update({
        where: { id: sale.id },
        data: {
          status: allReturned
            ? SaleStatus.RETURNED
            : anyReturned
              ? SaleStatus.PARTIALLY_RETURNED
              : SaleStatus.COMPLETED,
        },
      });

      return tx.productReturn.findUniqueOrThrow({
        where: { id: returnRecord.id },
        include: this.returnIncludes(),
      });
    });
  }

  private returnIncludes() {
    return {
      sale: {
        include: {
          student: true,
          branch: true,
          items: true,
        },
      },
      createdBy: {
        select: { id: true, fullName: true, email: true },
      },
      items: {
        include: { saleItem: { include: { product: true } } },
      },
      refunds: true,
    };
  }
}
