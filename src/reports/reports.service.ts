import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  ProductStatus,
  ReservationStatus,
  StockMovementType,
  UserRole,
} from '@prisma/client';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { ReportQueryDto } from './dto/report-query.dto';

export type DailyReportSection =
  | 'summary'
  | 'sales'
  | 'reservations'
  | 'delivered'
  | 'cancelled'
  | 'received'
  | 'stockout'
  | 'allmovements';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Prisma Decimal / string / number → plain number */
  private moneyNumber(value: unknown): number {
    if (value == null) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      'toNumber' in value &&
      typeof (value as { toNumber: unknown }).toNumber === 'function'
    ) {
      return (value as { toNumber: () => number }).toNumber();
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  async getDailyReport(
    user: AuthenticatedUser,
    query: ReportQueryDto,
    section: DailyReportSection = 'summary',
  ) {
    const range = this.buildDateRange(query);

    if (user.role === UserRole.ADMIN) {
      return this.getAdminDailySummary(query, range);
    }

    if (user.role === UserRole.CUSTOMER_SERVICE) {
      if (section === 'summary') {
        return this.getCustomerServiceDailySummary(user.id, range);
      }
      return this.getCustomerServiceDailySection(user.id, range, section);
    }

    if (user.role === UserRole.BRANCH_EMPLOYEE && user.branchId) {
      if (section === 'summary') {
        return this.getBranchDailySummary(user.branchId, range);
      }
      return this.getBranchDailySection(user.branchId, range, section);
    }

    throw new ForbiddenException('Cannot generate report');
  }

  private async getAdminDailySummary(
    query: ReportQueryDto,
    range: { gte: Date; lte: Date },
  ) {
    const branchFilter = query.branchId ? { branchId: query.branchId } : {};
    const productFilter = query.productId ? { productId: query.productId } : {};
    const saleItemProductFilter = query.productId
      ? { items: { some: { productId: query.productId } } }
      : {};

    const paymentBranchOr = query.branchId
      ? {
          OR: [
            { sale: { branchId: query.branchId } },
            { reservation: { branchId: query.branchId } },
          ],
        }
      : null;

    const paymentProductOr = query.productId
      ? {
          OR: [
            { sale: { items: { some: { productId: query.productId } } } },
            { reservation: { productId: query.productId } },
          ],
        }
      : null;

    const paymentWhere = {
      createdAt: range,
      ...(paymentBranchOr && paymentProductOr
        ? { AND: [paymentBranchOr, paymentProductOr] }
        : paymentBranchOr || paymentProductOr || {}),
    };

    const refundBranchOr = query.branchId
      ? {
          OR: [
            { sale: { branchId: query.branchId } },
            { reservation: { branchId: query.branchId } },
            { returnRecord: { sale: { branchId: query.branchId } } },
            { exchange: { sale: { branchId: query.branchId } } },
          ],
        }
      : {};

    const [
      salesCount,
      salesRows,
      reservationsCount,
      reservationPaidRows,
      deliveredReservations,
      returns,
      exchanges,
      paymentsList,
      refundsList,
      inventoryRows,
      saleItemsForCustomers,
      studyYears,
    ] = await Promise.all([
      this.prisma.sale.count({
        where: {
          ...branchFilter,
          ...saleItemProductFilter,
          createdAt: range,
        },
      }),
      this.prisma.sale.findMany({
        where: {
          ...branchFilter,
          ...saleItemProductFilter,
          createdAt: range,
        },
        select: {
          totalAmount: true,
          items: {
            where: productFilter.productId
              ? { productId: productFilter.productId }
              : undefined,
            select: {
              quantity: true,
              unitPrice: true,
              unitCost: true,
              total: true,
            },
          },
        },
      }),
      this.prisma.reservation.count({
        where: { ...branchFilter, ...productFilter, createdAt: range },
      }),
      this.prisma.reservation.findMany({
        where: { ...branchFilter, ...productFilter, createdAt: range },
        select: { paidAmount: true },
      }),
      this.prisma.reservation.count({
        where: {
          ...branchFilter,
          ...productFilter,
          status: ReservationStatus.DELIVERED,
          updatedAt: range,
        },
      }),
      this.prisma.productReturn.count({
        where: {
          createdAt: range,
          ...(query.branchId ? { sale: { branchId: query.branchId } } : {}),
          ...(query.productId
            ? { items: { some: { saleItem: { productId: query.productId } } } }
            : {}),
        },
      }),
      this.prisma.exchange.count({
        where: {
          createdAt: range,
          ...(query.branchId ? { sale: { branchId: query.branchId } } : {}),
          ...(query.productId
            ? {
                OR: [
                  { saleItem: { productId: query.productId } },
                  { newProductId: query.productId },
                ],
              }
            : {}),
        },
      }),
      this.prisma.payment.findMany({
        where: paymentWhere,
        select: { amount: true, method: true },
      }),
      this.prisma.refund.findMany({
        where: {
          createdAt: range,
          ...refundBranchOr,
        },
        select: { amount: true },
      }),
      this.prisma.inventory.findMany({
        where: {
          ...branchFilter,
          ...productFilter,
          product: { status: { not: ProductStatus.INACTIVE } },
        },
        select: {
          physicalQuantity: true,
          reservedQuantity: true,
        },
      }),
      this.prisma.saleItem.findMany({
        where: {
          ...(query.productId ? { productId: query.productId } : {}),
          sale: {
            createdAt: range,
            ...(query.branchId ? { branchId: query.branchId } : {}),
          },
        },
        include: {
          product: {
            include: {
              teacher: { select: { id: true, name: true } },
              studyYear: { select: { id: true, name: true } },
            },
          },
          sale: {
            include: {
              student: { select: { id: true, name: true, phone: true } },
            },
          },
        },
        orderBy: { sale: { createdAt: 'desc' } },
        take: 50,
      }),
      this.prisma.studyYear.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const salesAmount = salesRows.reduce((sum, sale) => {
      if (query.productId) {
        return (
          sum +
          sale.items.reduce(
            (itemSum, item) => itemSum + this.moneyNumber(item.total),
            0,
          )
        );
      }
      return sum + this.moneyNumber(sale.totalAmount);
    }, 0);

    const salesCost = salesRows.reduce(
      (sum, sale) =>
        sum +
        sale.items.reduce(
          (itemSum, item) =>
            itemSum +
            this.moneyNumber(item.unitCost) * Number(item.quantity || 0),
          0,
        ),
      0,
    );

    const reservationsPaidAmount = reservationPaidRows.reduce(
      (sum, row) => sum + this.moneyNumber(row.paidAmount),
      0,
    );

    const paymentsCollected = paymentsList.reduce(
      (sum, row) => sum + this.moneyNumber(row.amount),
      0,
    );
    const refundsTotal = refundsList.reduce(
      (sum, row) => sum + this.moneyNumber(row.amount),
      0,
    );
    const paymentsNet = Number((paymentsCollected - refundsTotal).toFixed(2));

    const paymentsByMethodMap = new Map<string, number>();
    for (const row of paymentsList) {
      const method = String(row.method || 'CASH').toUpperCase();
      const amount = this.moneyNumber(row.amount);
      paymentsByMethodMap.set(
        method,
        (paymentsByMethodMap.get(method) || 0) + amount,
      );
    }
    const paymentsByMethod = Array.from(paymentsByMethodMap.entries())
      .map(([method, amount]) => ({
        method,
        amount: Number(amount.toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount);

    let inventoryTotal = 0;
    let reservedQty = 0;
    let availableQty = 0;
    for (const row of inventoryRows) {
      const physical = Number(row.physicalQuantity || 0);
      const reserved = Number(row.reservedQuantity || 0);
      inventoryTotal += physical;
      reservedQty += reserved;
      availableQty += Math.max(physical - reserved, 0);
    }

    const customersByYearMap = new Map<string, Set<string>>();
    for (const year of studyYears) {
      customersByYearMap.set(year.name, new Set());
    }
    customersByYearMap.set('غير محدد', new Set());

    for (const item of saleItemsForCustomers) {
      const yearName = item.product?.studyYear?.name || 'غير محدد';
      const studentId = item.sale?.student?.id;
      if (!studentId) continue;
      if (!customersByYearMap.has(yearName)) {
        customersByYearMap.set(yearName, new Set());
      }
      customersByYearMap.get(yearName)!.add(studentId);
    }

    const customersByYear = Array.from(customersByYearMap.entries())
      .map(([label, students]) => ({
        label,
        value: students.size,
      }))
      .filter((row) => row.label !== 'غير محدد' || row.value > 0);

    const studentPurchases = saleItemsForCustomers.slice(0, 20).map((item) => ({
      student: item.sale?.student?.name || '-',
      teacher: item.product?.teacher?.name
        ? `أ. ${item.product.teacher.name}`
        : '-',
      phone: item.sale?.student?.phone || '',
      product: item.product?.name || '-',
    }));

    const netProfit = Number((salesAmount - salesCost).toFixed(2));

    return {
      section: 'summary' as const,
      scope: 'admin' as const,
      from: range.gte,
      to: range.lte,
      summary: {
        sales: salesCount,
        salesAmount: Number(salesAmount.toFixed(2)),
        reservations: reservationsCount,
        reservationsPaidAmount: Number(reservationsPaidAmount.toFixed(2)),
        deliveredReservations,
        returns,
        exchanges,
        inventoryTotal,
        books: {
          total: inventoryTotal,
          reserved: reservedQty,
          available: availableQty,
        },
        salesBreakdown: {
          branchSales: Number(salesAmount.toFixed(2)),
          reservations: Number(reservationsPaidAmount.toFixed(2)),
          netProfit,
        },
        paymentsCollected: Number(paymentsCollected.toFixed(2)),
        refundsTotal: Number(refundsTotal.toFixed(2)),
        paymentsTotal: paymentsNet,
        paymentsByMethod,
      },
      customersByYear,
      studentPurchases,
    };
  }

  private async getBranchDailySummary(
    branchId: string,
    dateRange: { gte: Date; lte: Date },
  ) {
    const [
      sales,
      reservations,
      deliveredReservations,
      cancelledReservations,
      returns,
      exchanges,
      stockMovementsCount,
      movementQtyRows,
      paymentsList,
      refundsList,
    ] = await Promise.all([
      this.prisma.sale.count({
        where: { branchId, createdAt: dateRange },
      }),
      this.prisma.reservation.count({
        where: { branchId, createdAt: dateRange },
      }),
      this.prisma.reservation.count({
        where: {
          branchId,
          status: ReservationStatus.DELIVERED,
          updatedAt: dateRange,
        },
      }),
      this.prisma.reservation.count({
        where: {
          branchId,
          status: ReservationStatus.CANCELLED,
          updatedAt: dateRange,
        },
      }),
      this.prisma.productReturn.count({
        where: { sale: { branchId }, createdAt: dateRange },
      }),
      this.prisma.exchange.count({
        where: { sale: { branchId }, createdAt: dateRange },
      }),
      this.prisma.stockMovement.count({
        where: { branchId, createdAt: dateRange },
      }),
      this.prisma.stockMovement.findMany({
        where: { branchId, createdAt: dateRange },
        select: { movementType: true, physicalQuantityChange: true },
      }),
      this.prisma.payment.findMany({
        where: {
          createdAt: dateRange,
          OR: [{ sale: { branchId } }, { reservation: { branchId } }],
        },
        select: { amount: true, method: true },
      }),
      this.prisma.refund.findMany({
        where: {
          createdAt: dateRange,
          OR: [
            { sale: { branchId } },
            { reservation: { branchId } },
            { returnRecord: { sale: { branchId } } },
            { exchange: { sale: { branchId } } },
          ],
        },
        select: { amount: true },
      }),
    ]);

    let receivedQty = 0;
    let stockOutQty = 0;

    for (const m of movementQtyRows) {
      if (
        m.movementType === StockMovementType.STOCK_IN ||
        m.movementType === StockMovementType.RETURN ||
        (m.physicalQuantityChange > 0 &&
          m.movementType !== StockMovementType.ADJUSTMENT &&
          m.movementType !== StockMovementType.RESERVATION &&
          m.movementType !== StockMovementType.RESERVATION_RELEASE)
      ) {
        receivedQty += Math.max(0, m.physicalQuantityChange);
      }

      if (
        m.movementType === StockMovementType.STOCK_OUT ||
        m.movementType === StockMovementType.DAMAGED
      ) {
        stockOutQty += Math.abs(m.physicalQuantityChange);
      }
    }

    const paymentsCollected = paymentsList.reduce(
      (sum, row) => sum + this.moneyNumber(row.amount),
      0,
    );
    const refundsTotal = refundsList.reduce(
      (sum, row) => sum + this.moneyNumber(row.amount),
      0,
    );
    const paymentsNet = Number((paymentsCollected - refundsTotal).toFixed(2));

    const paymentsByMethodMap = new Map<string, number>();
    for (const row of paymentsList) {
      const method = String(row.method || 'CASH').toUpperCase();
      const amount = this.moneyNumber(row.amount);
      paymentsByMethodMap.set(
        method,
        (paymentsByMethodMap.get(method) || 0) + amount,
      );
    }
    const paymentsByMethod = Array.from(paymentsByMethodMap.entries())
      .map(([method, amount]) => ({
        method,
        amount: Number(amount.toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      section: 'summary' as const,
      branchId,
      from: dateRange.gte,
      to: dateRange.lte,
      summary: {
        sales,
        reservations,
        deliveredReservations,
        cancelledReservations,
        returns,
        exchanges,
        paymentsCollected: Number(paymentsCollected.toFixed(2)),
        refundsTotal: Number(refundsTotal.toFixed(2)),
        paymentsTotal: paymentsNet,
        paymentsByMethod,
        receivedQty,
        stockOutQty,
        stockMovements: stockMovementsCount,
      },
    };
  }

  private async getCustomerServiceDailySummary(
    userId: string,
    dateRange: { gte: Date; lte: Date },
  ) {
    const actor = { createdById: userId };

    const [
      reservations,
      readyReservations,
      waitingReservations,
      deliveredReservations,
      cancelledReservations,
      studentsCreated,
      paymentsList,
      reservationRows,
    ] = await Promise.all([
      this.prisma.reservation.count({
        where: { ...actor, createdAt: dateRange },
      }),
      this.prisma.reservation.count({
        where: {
          ...actor,
          createdAt: dateRange,
          status: ReservationStatus.READY,
        },
      }),
      this.prisma.reservation.count({
        where: {
          ...actor,
          createdAt: dateRange,
          status: ReservationStatus.WAITING_FOR_STOCK,
        },
      }),
      this.prisma.reservation.count({
        where: {
          ...actor,
          status: ReservationStatus.DELIVERED,
          updatedAt: dateRange,
        },
      }),
      this.prisma.reservation.count({
        where: {
          ...actor,
          status: ReservationStatus.CANCELLED,
          updatedAt: dateRange,
        },
      }),
      this.prisma.student.count({
        where: { ...actor, createdAt: dateRange },
      }),
      this.prisma.payment.findMany({
        where: { ...actor, createdAt: dateRange },
        select: { amount: true, method: true },
      }),
      this.prisma.reservation.findMany({
        where: { ...actor, createdAt: dateRange },
        select: {
          branchId: true,
          branch: { select: { id: true, name: true } },
          paidAmount: true,
        },
      }),
    ]);

    const paymentsCollected = paymentsList.reduce(
      (sum, row) => sum + this.moneyNumber(row.amount),
      0,
    );

    const paymentsByMethodMap = new Map<string, number>();
    for (const row of paymentsList) {
      const method = String(row.method || 'CASH').toUpperCase();
      const amount = this.moneyNumber(row.amount);
      paymentsByMethodMap.set(
        method,
        (paymentsByMethodMap.get(method) || 0) + amount,
      );
    }
    const paymentsByMethod = Array.from(paymentsByMethodMap.entries())
      .map(([method, amount]) => ({
        method,
        amount: Number(amount.toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount);

    const byBranchMap = new Map<
      string,
      { branchId: string; branchName: string; reservations: number; paidTotal: number }
    >();
    for (const row of reservationRows) {
      const key = row.branchId;
      const current = byBranchMap.get(key) || {
        branchId: key,
        branchName: row.branch?.name || key,
        reservations: 0,
        paidTotal: 0,
      };
      current.reservations += 1;
      current.paidTotal += this.moneyNumber(row.paidAmount);
      byBranchMap.set(key, current);
    }
    const byBranch = Array.from(byBranchMap.values())
      .map((row) => ({
        ...row,
        paidTotal: Number(row.paidTotal.toFixed(2)),
      }))
      .sort((a, b) => b.reservations - a.reservations);

    return {
      section: 'summary' as const,
      scope: 'customer_service' as const,
      from: dateRange.gte,
      to: dateRange.lte,
      summary: {
        sales: 0,
        reservations,
        readyReservations,
        waitingReservations,
        deliveredReservations,
        cancelledReservations,
        studentsCreated,
        returns: 0,
        exchanges: 0,
        paymentsCollected: Number(paymentsCollected.toFixed(2)),
        refundsTotal: 0,
        paymentsTotal: Number(paymentsCollected.toFixed(2)),
        paymentsByMethod,
        receivedQty: 0,
        stockOutQty: 0,
        stockMovements: 0,
        branchesCount: byBranch.length,
        byBranch,
      },
    };
  }

  private async getCustomerServiceDailySection(
    userId: string,
    dateRange: { gte: Date; lte: Date },
    section: Exclude<DailyReportSection, 'summary'>,
  ) {
    const actor = { createdById: userId };
    const reservationInclude = {
      student: { select: { id: true, name: true, phone: true } },
      product: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
      payments: true,
      refunds: true,
    } as const;

    switch (section) {
      case 'reservations': {
        const reservations = await this.prisma.reservation.findMany({
          where: { ...actor, createdAt: dateRange },
          include: reservationInclude,
          orderBy: { createdAt: 'desc' },
        });
        return { section, reservations };
      }

      case 'delivered': {
        const deliveredReservations = await this.prisma.reservation.findMany({
          where: {
            ...actor,
            status: ReservationStatus.DELIVERED,
            updatedAt: dateRange,
          },
          include: reservationInclude,
          orderBy: { updatedAt: 'desc' },
        });
        return { section, deliveredReservations };
      }

      case 'cancelled': {
        const cancelledReservations = await this.prisma.reservation.findMany({
          where: {
            ...actor,
            status: ReservationStatus.CANCELLED,
            updatedAt: dateRange,
          },
          include: reservationInclude,
          orderBy: { updatedAt: 'desc' },
        });
        return { section, cancelledReservations };
      }

      case 'sales':
        return { section, sales: [] };

      case 'received':
        return { section, receivedProducts: [] };

      case 'stockout':
        return { section, stockOutProducts: [] };

      case 'allmovements':
        return { section, stockMovements: [] };

      default:
        throw new ForbiddenException('Invalid report section');
    }
  }

  private async getBranchDailySection(
    branchId: string,
    dateRange: { gte: Date; lte: Date },
    section: Exclude<DailyReportSection, 'summary'>,
  ) {
    const movementInclude = {
      product: { select: { id: true, name: true, type: true } },
      createdBy: { select: { id: true, fullName: true } },
    } as const;

    switch (section) {
      case 'sales': {
        const sales = await this.prisma.sale.findMany({
          where: { branchId, createdAt: dateRange },
          include: {
            student: { select: { id: true, name: true, phone: true } },
            items: {
              include: {
                product: { select: { id: true, name: true } },
              },
            },
            payments: true,
            createdBy: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
        });
        return { section, sales };
      }

      case 'reservations': {
        const reservations = await this.prisma.reservation.findMany({
          where: { branchId, createdAt: dateRange },
          include: {
            student: { select: { id: true, name: true, phone: true } },
            product: { select: { id: true, name: true } },
            createdBy: { select: { id: true, fullName: true } },
            payments: true,
            refunds: true,
          },
          orderBy: { createdAt: 'desc' },
        });
        return { section, reservations };
      }

      case 'delivered': {
        const deliveredReservations = await this.prisma.reservation.findMany({
          where: {
            branchId,
            status: ReservationStatus.DELIVERED,
            updatedAt: dateRange,
          },
          include: {
            student: { select: { id: true, name: true, phone: true } },
            product: { select: { id: true, name: true } },
            createdBy: { select: { id: true, fullName: true } },
          },
          orderBy: { updatedAt: 'desc' },
        });
        return { section, deliveredReservations };
      }

      case 'cancelled': {
        const cancelledReservations = await this.prisma.reservation.findMany({
          where: {
            branchId,
            status: ReservationStatus.CANCELLED,
            updatedAt: dateRange,
          },
          include: {
            student: { select: { id: true, name: true, phone: true } },
            product: { select: { id: true, name: true } },
            createdBy: { select: { id: true, fullName: true } },
            payments: true,
            refunds: true,
          },
          orderBy: { updatedAt: 'desc' },
        });
        return { section, cancelledReservations };
      }

      case 'received': {
        const stockMovements = await this.prisma.stockMovement.findMany({
          where: { branchId, createdAt: dateRange },
          include: movementInclude,
          orderBy: { createdAt: 'desc' },
        });
        const receivedProducts = stockMovements.filter(
          (m) =>
            m.movementType === StockMovementType.STOCK_IN ||
            m.movementType === StockMovementType.RETURN ||
            (m.physicalQuantityChange > 0 &&
              m.movementType !== StockMovementType.ADJUSTMENT &&
              m.movementType !== StockMovementType.RESERVATION &&
              m.movementType !== StockMovementType.RESERVATION_RELEASE),
        );
        return { section, receivedProducts };
      }

      case 'stockout': {
        const stockMovements = await this.prisma.stockMovement.findMany({
          where: {
            branchId,
            createdAt: dateRange,
            movementType: {
              in: [StockMovementType.STOCK_OUT, StockMovementType.DAMAGED],
            },
          },
          include: movementInclude,
          orderBy: { createdAt: 'desc' },
        });
        return { section, stockOutProducts: stockMovements };
      }

      case 'allmovements': {
        const stockMovements = await this.prisma.stockMovement.findMany({
          where: { branchId, createdAt: dateRange },
          include: movementInclude,
          orderBy: { createdAt: 'desc' },
        });
        return { section, stockMovements };
      }

      default:
        throw new ForbiddenException('Invalid report section');
    }
  }

  getSalesReport(user: AuthenticatedUser, query: ReportQueryDto) {
    const where = this.buildEntityFilter(user, query);
    return this.prisma.sale.findMany({
      where: { ...where, createdAt: this.buildDateRange(query) },
      include: {
        student: true,
        branch: true,
        items: { include: { product: true } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getReservationsReport(user: AuthenticatedUser, query: ReportQueryDto) {
    const where = this.buildEntityFilter(user, query);
    return this.prisma.reservation.findMany({
      where: { ...where, createdAt: this.buildDateRange(query) },
      include: {
        student: true,
        branch: true,
        product: true,
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getInventoryReport(user: AuthenticatedUser, query: ReportQueryDto) {
    const where =
      user.role === UserRole.BRANCH_EMPLOYEE && user.branchId
        ? { branchId: user.branchId }
        : query.branchId
          ? { branchId: query.branchId }
          : {};

    return this.prisma.inventory.findMany({
      where,
      include: {
        branch: true,
        product: true,
      },
    });
  }

  getStockMovementsReport(user: AuthenticatedUser, query: ReportQueryDto) {
    const where =
      user.role === UserRole.BRANCH_EMPLOYEE && user.branchId
        ? { branchId: user.branchId }
        : query.branchId
          ? { branchId: query.branchId }
          : {};

    return this.prisma.stockMovement.findMany({
      where: { ...where, createdAt: this.buildDateRange(query) },
      include: {
        branch: true,
        product: true,
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getExpensesReport(query: ReportQueryDto) {
    return this.prisma.expense.findMany({
      where: {
        expenseDate: this.buildDateRange(query, 'expenseDate'),
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
      include: {
        category: true,
        branch: true,
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { expenseDate: 'desc' },
    });
  }

  private buildEntityFilter(user: AuthenticatedUser, query: ReportQueryDto) {
    if (user.role === UserRole.ADMIN) {
      return query.branchId ? { branchId: query.branchId } : {};
    }

    if (user.role === UserRole.CUSTOMER_SERVICE) {
      return { createdById: user.id };
    }

    if (user.role === UserRole.BRANCH_EMPLOYEE && user.branchId) {
      return { branchId: user.branchId };
    }

    throw new ForbiddenException('Cannot access report');
  }

  private buildDateRange(
    query: ReportQueryDto,
    field: 'createdAt' | 'expenseDate' = 'createdAt',
  ) {
    const from = query.from
      ? new Date(query.from)
      : new Date(new Date().setHours(0, 0, 0, 0));
    const to = query.to
      ? new Date(query.to)
      : new Date(new Date().setHours(23, 59, 59, 999));

    return { gte: from, lte: to };
  }
}
