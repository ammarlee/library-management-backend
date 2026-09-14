import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AcademicYearStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';

@Injectable()
export class AcademicYearsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.academicYear.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const academicYear = await this.prisma.academicYear.findUnique({
      where: { id },
    });
    if (!academicYear) {
      throw new NotFoundException('Academic year not found');
    }
    return academicYear;
  }

  async create(dto: CreateAcademicYearDto) {
    try {
      return await this.prisma.academicYear.create({ data: dto });
    } catch {
      throw new ConflictException('Academic year name already exists');
    }
  }

  getActive() {
    return this.prisma.academicYear.findFirst({
      where: { status: AcademicYearStatus.ACTIVE },
    });
  }

  async activate(id: string) {
    const academicYear = await this.findOne(id);

    if (academicYear.status === AcademicYearStatus.ACTIVE) {
      throw new BadRequestException('Academic year is already active');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.academicYear.updateMany({
        where: { status: AcademicYearStatus.ACTIVE },
        data: { status: AcademicYearStatus.INACTIVE },
      });

      return tx.academicYear.update({
        where: { id },
        data: { status: AcademicYearStatus.ACTIVE },
      });
    });
  }
}
