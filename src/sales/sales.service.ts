import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BranchStatus,
  ProductStatus,
  StudentStatus,
  UserRole,
} from '@prisma/client';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { multiplyDecimal } from '../common/utils/decimal.util';
import { InventoryOperationsService } from '../inventory/inventory-operations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryOps: InventoryOperationsService,
  ) {}

  findAll(user: AuthenticatedUser) {
    const where =
      user.role === UserRole.BRANCH_EMPLOYEE && user.branchId
        ? { branchId: user.branchId }
        : {};

    return this.prisma.sale.findMany({
      where,
      include: this.saleIncludes(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: this.saleIncludes(),
    });

    if (!sale) {
      throw new NotFoundException('Sale not found');
    }

    if (
      user.role === UserRole.BRANCH_EMPLOYEE &&
      user.branchId !== sale.branchId
    ) {
      throw new ForbiddenException('Cannot view sale from another branch');
    }

    return sale;
  }

  async create(dto: CreateSaleDto, user: AuthenticatedUser) {
    if (user.role !== UserRole.BRANCH_EMPLOYEE || !user.branchId) {
      throw new ForbiddenException('Only branch employees can create sales');
    }

    const branchId = user.branchId;

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
      throw new BadRequestException('Branch is inactive');
    }

    if (!product || product.status === ProductStatus.INACTIVE) {
      throw new BadRequestException('Product not found or inactive');
    }

    const unitPrice = product.sellingPrice;
    const unitCost = product.purchasePrice;
    const itemTotal = multiplyDecimal(unitPrice, dto.quantity);

    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          studentId: dto.studentId,
          branchId,
          createdById: user.id,
          totalAmount: itemTotal,
          items: {
            create: {
              productId: dto.productId,
              quantity: dto.quantity,
              unitPrice,
              unitCost,
              total: itemTotal,
            },
          },
          payments: {
            create: {
              amount: itemTotal,
              method: dto.method,
              proofReference: dto.proofReference,
              createdById: user.id,
            },
          },
        },
        include: this.saleIncludes(),
      });

      await this.inventoryOps.sellStock(tx, {
        branchId,
        productId: dto.productId,
        quantity: dto.quantity,
        createdById: user.id,
        referenceId: sale.id,
      });

      return sale;
    });
  }

  private saleIncludes() {
    return {
      student: true,
      branch: true,
      createdBy: {
        select: { id: true, fullName: true, email: true },
      },
      items: {
        include: { product: true },
      },
      payments: true,
      returns: true,
      exchanges: true,
      reservation: true,
    };
  }
}
