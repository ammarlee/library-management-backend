import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AcademicYearStatus, Prisma, ProductType } from '@prisma/client';
import { toDecimal } from '../common/utils/decimal.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: ProductQueryDto = {}) {
    const where: Prisma.ProductWhereInput = {};
    const and: Prisma.ProductWhereInput[] = [];

    if (query.teacherId) {
      where.teacherId = query.teacherId;
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.studyYearId) {
      where.studyYearId = query.studyYearId;
    }

    const search = query.search?.trim();
    if (search) {
      const upper = search.toUpperCase();
      const typeMatches = Object.values(ProductType).filter((type) =>
        type.includes(upper),
      );

      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { teacher: { name: { contains: search, mode: 'insensitive' } } },
          { studyYear: { name: { contains: search, mode: 'insensitive' } } },
          ...(typeMatches.length
            ? [{ type: { in: typeMatches } }]
            : []),
          ...(search.includes('كتاب') || search.toLowerCase().includes('book')
            ? [{ type: ProductType.BOOK }]
            : []),
          ...(search.includes('كارت') ||
          search.includes('كارد') ||
          search.toLowerCase().includes('card')
            ? [{ type: ProductType.CARD }]
            : []),
        ],
      });
    }

    if (and.length) {
      where.AND = and;
    }

    return this.prisma.product.findMany({
      where,
      include: {
        teacher: true,
        studyYear: true,
        academicYear: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        teacher: true,
        studyYear: true,
        academicYear: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async create(dto: CreateProductDto) {
    const academicYearId =
      dto.academicYearId ?? (await this.resolveActiveAcademicYearId());

    return this.prisma.product.create({
      data: {
        name: dto.name,
        type: dto.type,
        teacherId: dto.teacherId,
        studyYearId: dto.studyYearId,
        academicYearId,
        purchasePrice: toDecimal(dto.purchasePrice),
        sellingPrice: toDecimal(dto.sellingPrice),
        profitPercentage: toDecimal(dto.profitPercentage),
        reservationAllowed: dto.reservationAllowed ?? false,
        reservationPrice: dto.reservationPrice
          ? toDecimal(dto.reservationPrice)
          : null,
      },
      include: {
        teacher: true,
        studyYear: true,
        academicYear: true,
      },
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);

    const data: Prisma.ProductUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.teacherId !== undefined) {
      data.teacher = { connect: { id: dto.teacherId } };
    }
    if (dto.studyYearId !== undefined) {
      data.studyYear =
        dto.studyYearId === null
          ? { disconnect: true }
          : { connect: { id: dto.studyYearId } };
    }
    if (dto.academicYearId !== undefined) {
      data.academicYear = { connect: { id: dto.academicYearId } };
    }
    if (dto.purchasePrice !== undefined) {
      data.purchasePrice = toDecimal(dto.purchasePrice);
    }
    if (dto.sellingPrice !== undefined) {
      data.sellingPrice = toDecimal(dto.sellingPrice);
    }
    if (dto.profitPercentage !== undefined) {
      data.profitPercentage = toDecimal(dto.profitPercentage);
    }
    if (dto.reservationAllowed !== undefined) {
      data.reservationAllowed = dto.reservationAllowed;
    }
    if (dto.reservationPrice !== undefined) {
      data.reservationPrice =
        dto.reservationPrice === null
          ? null
          : toDecimal(dto.reservationPrice);
    }

    return this.prisma.product.update({
      where: { id },
      data,
      include: {
        teacher: true,
        studyYear: true,
        academicYear: true,
      },
    });
  }

  async updateStatus(id: string, dto: UpdateProductStatusDto) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: { status: dto.status },
      include: {
        teacher: true,
        studyYear: true,
        academicYear: true,
      },
    });
  }

  private async resolveActiveAcademicYearId() {
    const active = await this.prisma.academicYear.findFirst({
      where: { status: AcademicYearStatus.ACTIVE },
    });

    if (!active) {
      throw new BadRequestException('No active academic year found');
    }

    return active.id;
  }
}
