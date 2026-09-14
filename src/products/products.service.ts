import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toDecimal } from '../common/utils/decimal.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.product.findMany({
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

  create(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        name: dto.name,
        type: dto.type,
        teacherId: dto.teacherId,
        studyYearId: dto.studyYearId,
        academicYearId: dto.academicYearId,
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
      data.studyYear = { connect: { id: dto.studyYearId } };
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
      data.reservationPrice = toDecimal(dto.reservationPrice);
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
}
