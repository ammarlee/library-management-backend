import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';
import { UpdateTeacherStatusDto } from './dto/update-teacher-status.dto';

@Injectable()
export class TeachersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.teacher.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const teacher = await this.prisma.teacher.findUnique({ where: { id } });
    if (!teacher) {
      throw new NotFoundException('Teacher not found');
    }
    return teacher;
  }

  create(dto: CreateTeacherDto) {
    return this.prisma.teacher.create({ data: dto });
  }

  async update(id: string, dto: UpdateTeacherDto) {
    await this.findOne(id);
    return this.prisma.teacher.update({ where: { id }, data: dto });
  }

  async updateStatus(id: string, dto: UpdateTeacherStatusDto) {
    await this.findOne(id);
    return this.prisma.teacher.update({
      where: { id },
      data: { status: dto.status },
    });
  }
}
