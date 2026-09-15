import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StudentLogAction, StudentStatus } from '@prisma/client';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PRISMA_TX_OPTIONS } from '../common/utils/prisma-tx.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(search?: string) {
    const term = search?.trim();
    const where: Prisma.StudentWhereInput = {
      deletedAt: null,
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { phone: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return this.prisma.student.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: term ? 50 : undefined,
    });
  }

  async findOne(id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, deletedAt: null },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    return student;
  }

  create(dto: CreateStudentDto, user: AuthenticatedUser) {
    return this.prisma.student.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        createdById: user.id,
      },
    });
  }

  async update(id: string, dto: UpdateStudentDto, user: AuthenticatedUser) {
    const student = await this.findOne(id);
    const oldData = this.toLogData(student);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.student.update({
        where: { id },
        data: dto,
      });

      await tx.studentLog.create({
        data: {
          studentId: id,
          action: StudentLogAction.UPDATED,
          oldData,
          newData: this.toLogData(result),
          createdById: user.id,
        },
      });

      return result;
    }, PRISMA_TX_OPTIONS);

    return updated;
  }

  async softDelete(id: string, user: AuthenticatedUser) {
    const student = await this.findOne(id);
    const oldData = this.toLogData(student);

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.student.update({
        where: { id },
        data: {
          status: StudentStatus.INACTIVE,
          deletedAt: new Date(),
        },
      });

      await tx.studentLog.create({
        data: {
          studentId: id,
          action: StudentLogAction.DEACTIVATED,
          oldData,
          newData: Prisma.JsonNull,
          createdById: user.id,
        },
      });

      return result;
    }, PRISMA_TX_OPTIONS);
  }

  private toLogData(student: {
    id: string;
    name: string;
    phone: string | null;
    status: StudentStatus;
  }): Prisma.InputJsonValue {
    return {
      id: student.id,
      name: student.name,
      phone: student.phone,
      status: student.status,
    };
  }
}
