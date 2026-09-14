import { BadRequestException } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { InventoryOperationsService } from './inventory-operations.service';

describe('InventoryOperationsService', () => {
  let service: InventoryOperationsService;

  const tx = {
    inventory: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $queryRaw: jest.fn(),
    stockMovement: { create: jest.fn() },
    reservation: { findMany: jest.fn(), update: jest.fn() },
  };

  beforeEach(() => {
    service = new InventoryOperationsService({} as never);
    jest.clearAllMocks();
  });

  it('calculates available quantity', () => {
    expect(
      service.getAvailableQuantity({ physicalQuantity: 10, reservedQuantity: 3 }),
    ).toBe(7);
  });

  it('rejects negative stock removal', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'inv-1' }]);
    tx.inventory.findUniqueOrThrow.mockResolvedValue({
      id: 'inv-1',
      physicalQuantity: 2,
      reservedQuantity: 0,
    });

    await expect(
      service.removeStock(tx as never, {
        branchId: 'branch-1',
        productId: 'product-1',
        quantity: 5,
        createdById: 'user-1',
        movementType: StockMovementType.DAMAGED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
