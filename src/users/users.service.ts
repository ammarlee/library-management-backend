import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: this.userSelect(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: this.userSelect(),
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async create(dto: CreateUserDto) {
    this.validateBranchRules(dto.role, dto.branchId);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('Email already in use');
    }

    if (dto.branchId) {
      await this.ensureBranchExists(dto.branchId);
    }

    const passwordHash = await argon2.hash(dto.password);

    return this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        fullName: dto.fullName,
        phone: dto.phone,
        role: dto.role,
        branchId: dto.branchId ?? null,
      },
      select: this.userSelect(),
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const role = dto.role ?? user.role;
    const branchId =
      dto.branchId !== undefined ? dto.branchId : user.branchId ?? undefined;

    this.validateBranchRules(role, branchId);

    if (dto.email) {
      const existing = await this.prisma.user.findFirst({
        where: {
          email: dto.email.toLowerCase(),
          NOT: { id },
        },
      });
      if (existing) {
        throw new ConflictException('Email already in use');
      }
    }

    if (dto.branchId) {
      await this.ensureBranchExists(dto.branchId);
    }

    const data: Record<string, unknown> = {
      email: dto.email?.toLowerCase(),
      fullName: dto.fullName,
      phone: dto.phone,
      role: dto.role,
      branchId: dto.branchId !== undefined ? dto.branchId : undefined,
    };

    if (dto.password) {
      data.passwordHash = await argon2.hash(dto.password);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: this.userSelect(),
    });
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto) {
    await this.findOne(id);

    return this.prisma.user.update({
      where: { id },
      data: { status: dto.status },
      select: this.userSelect(),
    });
  }

  private validateBranchRules(role: UserRole, branchId?: string | null) {
    if (role === UserRole.BRANCH_EMPLOYEE && !branchId) {
      throw new BadRequestException('Branch employees must have a branch');
    }

    if (
      (role === UserRole.ADMIN || role === UserRole.CUSTOMER_SERVICE) &&
      branchId
    ) {
      throw new BadRequestException(
        'Admin and customer service users cannot be assigned to a branch',
      );
    }
  }

  private async ensureBranchExists(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
  }

  private userSelect() {
    return {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      status: true,
      branchId: true,
      createdAt: true,
      updatedAt: true,
    };
  }
}
