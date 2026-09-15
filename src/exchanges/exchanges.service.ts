import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductStatus, SaleStatus } from '@prisma/client';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { multiplyDecimal } from '../common/utils/decimal.util';
import { PRISMA_TX_OPTIONS } from '../common/utils/prisma-tx.util';
import { InventoryOperationsService } from '../inventory/inventory-operations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExchangeDto } from './dto/create-exchange.dto';

@Injectable()
export class ExchangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryOps: InventoryOperationsService,
  ) {}

  findAll() {
    return this.prisma.exchange.findMany({
      include: this.exchangeIncludes(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const exchange = await this.prisma.exchange.findUnique({
      where: { id },
      include: this.exchangeIncludes(),
    });

    if (!exchange) {
      throw new NotFoundException('Exchange not found');
    }

    return exchange;
  }

  async create(dto: CreateExchangeDto, user: AuthenticatedUser) {
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

    const saleItem = sale.items.find((item) => item.id === dto.saleItemId);
    if (!saleItem) {
      throw new BadRequestException('Sale item not found');
    }

    if (saleItem.productId === dto.newProductId) {
      throw new BadRequestException('New product must be different from the current product');
    }

    const remaining = saleItem.quantity - saleItem.returnedQuantity;
    if (remaining <= 0) {
      throw new BadRequestException('No remaining quantity available for exchange');
    }
    if (dto.quantity > remaining) {
      throw new BadRequestException('Exchange quantity exceeds remaining quantity');
    }

    const newProduct = await this.prisma.product.findUnique({
      where: { id: dto.newProductId },
    });

    if (!newProduct || newProduct.status === ProductStatus.INACTIVE) {
      throw new BadRequestException('New product not found or inactive');
    }

    const inventory = await this.prisma.inventory.findUnique({
      where: {
        branchId_productId: {
          branchId: sale.branchId,
          productId: dto.newProductId,
        },
      },
    });

    const available =
      (inventory?.physicalQuantity || 0) - (inventory?.reservedQuantity || 0);
    if (!inventory || available < dto.quantity) {
      throw new BadRequestException(
        'New product is not available in the sale branch stock',
      );
    }

    const oldTotal = multiplyDecimal(saleItem.unitPrice, dto.quantity);
    const newTotal = multiplyDecimal(newProduct.sellingPrice, dto.quantity);
    const differenceAmount = newTotal.sub(oldTotal);

    return this.prisma.$transaction(async (tx) => {
      await this.inventoryOps.returnStock(tx, {
        branchId: sale.branchId,
        productId: saleItem.productId,
        quantity: dto.quantity,
        createdById: user.id,
      });

      await this.inventoryOps.sellStock(tx, {
        branchId: sale.branchId,
        productId: dto.newProductId,
        quantity: dto.quantity,
        createdById: user.id,
      });

      const exchange = await tx.exchange.create({
        data: {
          saleId: sale.id,
          saleItemId: saleItem.id,
          newProductId: dto.newProductId,
          quantity: dto.quantity,
          createdById: user.id,
          differenceAmount,
        },
      });

      if (differenceAmount.gt(0)) {
        if (!dto.paymentMethod) {
          throw new BadRequestException('Payment method is required');
        }

        await tx.payment.create({
          data: {
            saleId: sale.id,
            amount: differenceAmount,
            method: dto.paymentMethod,
            proofReference: dto.proofReference,
            createdById: user.id,
          },
        });
      } else if (differenceAmount.lt(0)) {
        if (!dto.refundMethod) {
          throw new BadRequestException('Refund method is required');
        }

        await tx.refund.create({
          data: {
            saleId: sale.id,
            exchangeId: exchange.id,
            amount: differenceAmount.abs(),
            method: dto.refundMethod,
            createdById: user.id,
          },
        });
      }

      await tx.saleItem.update({
        where: { id: saleItem.id },
        data: {
          returnedQuantity: saleItem.returnedQuantity + dto.quantity,
        },
      });

      // Keep sale total aligned with net money movement after exchange.
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          totalAmount: sale.totalAmount.add(differenceAmount),
        },
      });

      // Track the replacement product on the sale for future refund/exchange.
      await tx.saleItem.create({
        data: {
          saleId: sale.id,
          productId: dto.newProductId,
          quantity: dto.quantity,
          unitPrice: newProduct.sellingPrice,
          unitCost: newProduct.purchasePrice,
          total: newTotal,
          returnedQuantity: 0,
        },
      });

      return tx.exchange.findUniqueOrThrow({
        where: { id: exchange.id },
        include: this.exchangeIncludes(),
      });
    }, PRISMA_TX_OPTIONS);
  }

  private exchangeIncludes() {
    return {
      sale: {
        include: {
          student: true,
          branch: true,
        },
      },
      saleItem: {
        include: { product: true },
      },
      newProduct: true,
      createdBy: {
        select: { id: true, fullName: true, email: true },
      },
      refunds: true,
    };
  }
}
