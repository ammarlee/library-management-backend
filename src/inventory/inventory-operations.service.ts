import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Inventory,
  Prisma,
  ReservationStatus,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type TransactionClient = Prisma.TransactionClient;

export interface StockMovementInput {
  branchId: string;
  productId: string;
  movementType: StockMovementType;
  physicalQuantityChange: number;
  reservedQuantityChange: number;
  createdById: string;
  referenceId?: string;
  note?: string;
}

@Injectable()
export class InventoryOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  getAvailableQuantity(inventory: Pick<Inventory, 'physicalQuantity' | 'reservedQuantity'>) {
    return inventory.physicalQuantity - inventory.reservedQuantity;
  }

  async ensureInventory(
    tx: TransactionClient,
    branchId: string,
    productId: string,
  ) {
    const existing = await tx.inventory.findUnique({
      where: { branchId_productId: { branchId, productId } },
    });

    if (existing) {
      return existing;
    }

    return tx.inventory.create({
      data: { branchId, productId },
    });
  }

  async lockInventory(
    tx: TransactionClient,
    branchId: string,
    productId: string,
  ) {
    await this.ensureInventory(tx, branchId, productId);

    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Inventory"
      WHERE "branchId" = ${branchId}::uuid AND "productId" = ${productId}::uuid
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new BadRequestException('Inventory record not found');
    }

    return tx.inventory.findUniqueOrThrow({
      where: { branchId_productId: { branchId, productId } },
    });
  }

  async createMovement(tx: TransactionClient, input: StockMovementInput) {
    return tx.stockMovement.create({
      data: {
        branchId: input.branchId,
        productId: input.productId,
        movementType: input.movementType,
        physicalQuantityChange: input.physicalQuantityChange,
        reservedQuantityChange: input.reservedQuantityChange,
        createdById: input.createdById,
        referenceId: input.referenceId,
        note: input.note,
      },
    });
  }

  async addStock(
    tx: TransactionClient,
    params: {
      branchId: string;
      productId: string;
      quantity: number;
      createdById: string;
      movementType?: StockMovementType;
      note?: string;
      referenceId?: string;
      allocateReservations?: boolean;
    },
  ) {
    if (params.quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    await this.lockInventory(tx, params.branchId, params.productId);

    const updated = await tx.inventory.update({
      where: {
        branchId_productId: {
          branchId: params.branchId,
          productId: params.productId,
        },
      },
      data: {
        physicalQuantity: { increment: params.quantity },
      },
    });

    await this.createMovement(tx, {
      branchId: params.branchId,
      productId: params.productId,
      movementType: params.movementType ?? StockMovementType.STOCK_IN,
      physicalQuantityChange: params.quantity,
      reservedQuantityChange: 0,
      createdById: params.createdById,
      note: params.note,
      referenceId: params.referenceId,
    });

    if (params.allocateReservations !== false) {
      await this.allocateWaitingReservations(
        tx,
        params.branchId,
        params.productId,
        params.createdById,
      );
    }

    return updated;
  }

  async removeStock(
    tx: TransactionClient,
    params: {
      branchId: string;
      productId: string;
      quantity: number;
      createdById: string;
      movementType: StockMovementType;
      note?: string;
      referenceId?: string;
    },
  ) {
    if (params.quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    const inventory = await this.lockInventory(
      tx,
      params.branchId,
      params.productId,
    );

    if (inventory.physicalQuantity < params.quantity) {
      throw new BadRequestException('Insufficient physical stock');
    }

    if (inventory.physicalQuantity - params.quantity < inventory.reservedQuantity) {
      throw new BadRequestException(
        'Cannot reduce stock below reserved quantity',
      );
    }

    const updated = await tx.inventory.update({
      where: {
        branchId_productId: {
          branchId: params.branchId,
          productId: params.productId,
        },
      },
      data: {
        physicalQuantity: { decrement: params.quantity },
      },
    });

    await this.createMovement(tx, {
      branchId: params.branchId,
      productId: params.productId,
      movementType: params.movementType,
      physicalQuantityChange: -params.quantity,
      reservedQuantityChange: 0,
      createdById: params.createdById,
      note: params.note,
      referenceId: params.referenceId,
    });

    return updated;
  }

  async adjustStock(
    tx: TransactionClient,
    params: {
      branchId: string;
      productId: string;
      newPhysicalQuantity: number;
      createdById: string;
      note?: string;
    },
  ) {
    if (params.newPhysicalQuantity < 0) {
      throw new BadRequestException('Physical quantity cannot be negative');
    }

    const inventory = await this.lockInventory(
      tx,
      params.branchId,
      params.productId,
    );

    if (params.newPhysicalQuantity < inventory.reservedQuantity) {
      throw new BadRequestException(
        'Adjusted quantity cannot be less than reserved quantity',
      );
    }

    const delta = params.newPhysicalQuantity - inventory.physicalQuantity;
    if (delta === 0) {
      return inventory;
    }

    const updated = await tx.inventory.update({
      where: {
        branchId_productId: {
          branchId: params.branchId,
          productId: params.productId,
        },
      },
      data: { physicalQuantity: params.newPhysicalQuantity },
    });

    await this.createMovement(tx, {
      branchId: params.branchId,
      productId: params.productId,
      movementType: StockMovementType.ADJUSTMENT,
      physicalQuantityChange: delta,
      reservedQuantityChange: 0,
      createdById: params.createdById,
      note: params.note,
    });

    if (delta > 0) {
      await this.allocateWaitingReservations(
        tx,
        params.branchId,
        params.productId,
        params.createdById,
      );
    }

    return updated;
  }

  async reserveStock(
    tx: TransactionClient,
    params: {
      branchId: string;
      productId: string;
      quantity: number;
      createdById: string;
      referenceId?: string;
    },
  ) {
    if (params.quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    const inventory = await this.lockInventory(
      tx,
      params.branchId,
      params.productId,
    );

    const available = this.getAvailableQuantity(inventory);
    if (available < params.quantity) {
      throw new BadRequestException('Insufficient available stock to reserve');
    }

    const updated = await tx.inventory.update({
      where: {
        branchId_productId: {
          branchId: params.branchId,
          productId: params.productId,
        },
      },
      data: {
        reservedQuantity: { increment: params.quantity },
      },
    });

    await this.createMovement(tx, {
      branchId: params.branchId,
      productId: params.productId,
      movementType: StockMovementType.RESERVATION,
      physicalQuantityChange: 0,
      reservedQuantityChange: params.quantity,
      createdById: params.createdById,
      referenceId: params.referenceId,
    });

    return updated;
  }

  async releaseReservedStock(
    tx: TransactionClient,
    params: {
      branchId: string;
      productId: string;
      quantity: number;
      createdById: string;
      referenceId?: string;
    },
  ) {
    if (params.quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    const inventory = await this.lockInventory(
      tx,
      params.branchId,
      params.productId,
    );

    if (inventory.reservedQuantity < params.quantity) {
      throw new BadRequestException('Insufficient reserved stock to release');
    }

    const updated = await tx.inventory.update({
      where: {
        branchId_productId: {
          branchId: params.branchId,
          productId: params.productId,
        },
      },
      data: {
        reservedQuantity: { decrement: params.quantity },
      },
    });

    await this.createMovement(tx, {
      branchId: params.branchId,
      productId: params.productId,
      movementType: StockMovementType.RESERVATION_RELEASE,
      physicalQuantityChange: 0,
      reservedQuantityChange: -params.quantity,
      createdById: params.createdById,
      referenceId: params.referenceId,
    });

    return updated;
  }

  async sellStock(
    tx: TransactionClient,
    params: {
      branchId: string;
      productId: string;
      quantity: number;
      createdById: string;
      referenceId?: string;
      fromReservation?: boolean;
    },
  ) {
    if (params.quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    const inventory = await this.lockInventory(
      tx,
      params.branchId,
      params.productId,
    );

    if (params.fromReservation) {
      if (inventory.reservedQuantity < params.quantity) {
        throw new BadRequestException('Insufficient reserved stock');
      }
      if (inventory.physicalQuantity < params.quantity) {
        throw new BadRequestException('Insufficient physical stock');
      }

      return this.completeSaleWithReservation(tx, params, inventory);
    }

    const available = this.getAvailableQuantity(inventory);
    if (available < params.quantity) {
      throw new BadRequestException('Insufficient available stock');
    }

    const updated = await tx.inventory.update({
      where: {
        branchId_productId: {
          branchId: params.branchId,
          productId: params.productId,
        },
      },
      data: {
        physicalQuantity: { decrement: params.quantity },
      },
    });

    await this.createMovement(tx, {
      branchId: params.branchId,
      productId: params.productId,
      movementType: StockMovementType.SALE,
      physicalQuantityChange: -params.quantity,
      reservedQuantityChange: 0,
      createdById: params.createdById,
      referenceId: params.referenceId,
    });

    return updated;
  }

  private async completeSaleWithReservation(
    tx: TransactionClient,
    params: {
      branchId: string;
      productId: string;
      quantity: number;
      createdById: string;
      referenceId?: string;
    },
    _inventory: Inventory,
  ) {
    const updated = await tx.inventory.update({
      where: {
        branchId_productId: {
          branchId: params.branchId,
          productId: params.productId,
        },
      },
      data: {
        physicalQuantity: { decrement: params.quantity },
        reservedQuantity: { decrement: params.quantity },
      },
    });

    await this.createMovement(tx, {
      branchId: params.branchId,
      productId: params.productId,
      movementType: StockMovementType.SALE,
      physicalQuantityChange: -params.quantity,
      reservedQuantityChange: -params.quantity,
      createdById: params.createdById,
      referenceId: params.referenceId,
    });

    return updated;
  }

  async returnStock(
    tx: TransactionClient,
    params: {
      branchId: string;
      productId: string;
      quantity: number;
      createdById: string;
      referenceId?: string;
    },
  ) {
    if (params.quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    await this.lockInventory(tx, params.branchId, params.productId);

    const updated = await tx.inventory.update({
      where: {
        branchId_productId: {
          branchId: params.branchId,
          productId: params.productId,
        },
      },
      data: {
        physicalQuantity: { increment: params.quantity },
      },
    });

    await this.createMovement(tx, {
      branchId: params.branchId,
      productId: params.productId,
      movementType: StockMovementType.RETURN,
      physicalQuantityChange: params.quantity,
      reservedQuantityChange: 0,
      createdById: params.createdById,
      referenceId: params.referenceId,
    });

    await this.allocateWaitingReservations(
      tx,
      params.branchId,
      params.productId,
      params.createdById,
    );

    return updated;
  }

  async allocateWaitingReservations(
    tx: TransactionClient,
    branchId: string,
    productId: string,
    createdById: string,
  ) {
    const waitingReservations = await tx.reservation.findMany({
      where: {
        branchId,
        productId,
        status: {
          in: [ReservationStatus.WAITING_FOR_STOCK, ReservationStatus.PENDING],
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const reservation of waitingReservations) {
      const inventory = await this.lockInventory(tx, branchId, productId);
      const available = this.getAvailableQuantity(inventory);

      if (available < reservation.quantity) {
        continue;
      }

      await tx.inventory.update({
        where: {
          branchId_productId: { branchId, productId },
        },
        data: {
          reservedQuantity: { increment: reservation.quantity },
        },
      });

      await this.createMovement(tx, {
        branchId,
        productId,
        movementType: StockMovementType.RESERVATION,
        physicalQuantityChange: 0,
        reservedQuantityChange: reservation.quantity,
        createdById,
        referenceId: reservation.id,
      });

      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: ReservationStatus.READY },
      });
    }
  }
}
