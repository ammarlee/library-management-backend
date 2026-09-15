import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductStatus, StockMovementType, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryQueryDto } from './dto/inventory-query.dto';
import { StockQuantityDto } from './dto/stock-quantity.dto';
import { InventoryOperationsService } from './inventory-operations.service';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryOps: InventoryOperationsService,
  ) {}

  async findAll(user: AuthenticatedUser, query: InventoryQueryDto = {}) {
    const where =
      user.role === UserRole.BRANCH_EMPLOYEE && user.branchId
        ? { branchId: user.branchId }
        : {};

    const inventories = await this.prisma.inventory.findMany({
      where,
      include: {
        branch: true,
        product: {
          include: {
            teacher: true,
            studyYear: true,
            academicYear: true,
          },
        },
      },
      orderBy: [{ branchId: 'asc' }, { productId: 'asc' }],
    });

    return this.applyInventoryFilters(
      inventories.map((item) => this.withAvailableQuantity(item)),
      query,
    );
  }

  async findByBranch(
    branchId: string,
    user: AuthenticatedUser,
    query: InventoryQueryDto = {},
  ) {
    this.assertBranchAccess(user, branchId);

    const inventories = await this.prisma.inventory.findMany({
      where: { branchId },
      include: {
        branch: true,
        product: {
          include: {
            teacher: true,
            studyYear: true,
            academicYear: true,
          },
        },
      },
    });

    return this.applyInventoryFilters(
      inventories.map((item) => this.withAvailableQuantity(item)),
      query,
    );
  }

  async findOne(branchId: string, productId: string, user: AuthenticatedUser) {
    this.assertBranchAccess(user, branchId);

    const inventory = await this.prisma.inventory.findUnique({
      where: { branchId_productId: { branchId, productId } },
      include: {
        branch: true,
        product: {
          include: {
            teacher: true,
            studyYear: true,
            academicYear: true,
          },
        },
      },
    });

    if (!inventory) {
      throw new NotFoundException('Inventory not found');
    }

    return this.withAvailableQuantity(inventory);
  }

  async addStock(
    branchId: string,
    productId: string,
    dto: StockQuantityDto,
    user: AuthenticatedUser,
  ) {
    await this.ensureProductExists(productId);

    return this.prisma.$transaction(
      (tx) =>
        this.inventoryOps.addStock(tx, {
          branchId,
          productId,
          quantity: dto.quantity,
          createdById: user.id,
          note: dto.note,
        }),
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  async removeStock(
    branchId: string,
    productId: string,
    dto: StockQuantityDto,
    user: AuthenticatedUser,
  ) {
    await this.ensureProductExists(productId);

    return this.prisma.$transaction(
      (tx) =>
        this.inventoryOps.removeStock(tx, {
          branchId,
          productId,
          quantity: dto.quantity,
          createdById: user.id,
          movementType: StockMovementType.DAMAGED,
          note: dto.note,
        }),
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  async adjustStock(
    branchId: string,
    productId: string,
    dto: AdjustStockDto,
    user: AuthenticatedUser,
  ) {
    await this.ensureProductExists(productId);

    return this.prisma.$transaction(
      (tx) =>
        this.inventoryOps.adjustStock(tx, {
          branchId,
          productId,
          newPhysicalQuantity: dto.newPhysicalQuantity,
          createdById: user.id,
          note: dto.note,
        }),
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  getMovements(branchId: string, productId: string, user: AuthenticatedUser) {
    this.assertBranchAccess(user, branchId);

    return this.prisma.stockMovement.findMany({
      where: { branchId, productId },
      include: {
        createdBy: {
          select: { id: true, fullName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private withAvailableQuantity<
    T extends { physicalQuantity: number; reservedQuantity: number },
  >(inventory: T) {
    return {
      ...inventory,
      availableQuantity: this.inventoryOps.getAvailableQuantity(inventory),
    };
  }

  private applyInventoryFilters<
    T extends {
      availableQuantity: number;
      product?: { status?: ProductStatus | string } | null;
    },
  >(items: T[], query: InventoryQueryDto) {
    if (!query.availableOnly) {
      return items;
    }

    return items.filter(
      (item) =>
        item.availableQuantity > 0 &&
        item.product?.status !== ProductStatus.INACTIVE,
    );
  }

  private assertBranchAccess(user: AuthenticatedUser, branchId: string) {
    if (
      user.role === UserRole.BRANCH_EMPLOYEE &&
      user.branchId !== branchId
    ) {
      throw new ForbiddenException('Cannot access another branch inventory');
    }
  }

  private async ensureProductExists(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
  }
}
