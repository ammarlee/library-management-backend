import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudyYearDto } from './dto/create-study-year.dto';
import { UpdateStudyYearDto } from './dto/update-study-year.dto';

@Injectable()
export class StudyYearsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.studyYear.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const studyYear = await this.prisma.studyYear.findUnique({ where: { id } });
    if (!studyYear) {
      throw new NotFoundException('Study year not found');
    }
    return studyYear;
  }

  async create(dto: CreateStudyYearDto) {
    try {
      return await this.prisma.studyYear.create({ data: dto });
    } catch {
      throw new ConflictException('Study year name already exists');
    }
  }

  async update(id: string, dto: UpdateStudyYearDto) {
    await this.findOne(id);
    try {
      return await this.prisma.studyYear.update({ where: { id }, data: dto });
    } catch {
      throw new ConflictException('Study year name already exists');
    }
  }
}
