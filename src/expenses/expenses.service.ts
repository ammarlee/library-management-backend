import { Injectable, NotFoundException } from '@nestjs/common';
import { toDecimal } from '../common/utils/decimal.util';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  findAllCategories() {
    return this.prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } });
  }

  createCategory(dto: CreateExpenseCategoryDto) {
    return this.prisma.expenseCategory.create({ data: dto });
  }

  async updateCategory(id: string, dto: UpdateExpenseCategoryDto) {
    await this.ensureCategoryExists(id);
    return this.prisma.expenseCategory.update({ where: { id }, data: dto });
  }

  findAllExpenses() {
    return this.prisma.expense.findMany({
      include: {
        category: true,
        branch: true,
        createdBy: {
          select: { id: true, fullName: true, email: true },
        },
      },
      orderBy: { expenseDate: 'desc' },
    });
  }

  async findOneExpense(id: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
      include: {
        category: true,
        branch: true,
        createdBy: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    return expense;
  }

  createExpense(dto: CreateExpenseDto, user: AuthenticatedUser) {
    return this.prisma.expense.create({
      data: {
        categoryId: dto.categoryId,
        branchId: dto.branchId,
        amount: toDecimal(dto.amount),
        description: dto.description,
        expenseDate: new Date(dto.expenseDate),
        createdById: user.id,
      },
      include: {
        category: true,
        branch: true,
        createdBy: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });
  }

  async updateExpense(id: string, dto: UpdateExpenseDto) {
    await this.findOneExpense(id);

    return this.prisma.expense.update({
      where: { id },
      data: {
        categoryId: dto.categoryId,
        branchId: dto.branchId,
        amount: dto.amount !== undefined ? toDecimal(dto.amount) : undefined,
        description: dto.description,
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : undefined,
      },
      include: {
        category: true,
        branch: true,
        createdBy: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });
  }

  private async ensureCategoryExists(id: string) {
    const category = await this.prisma.expenseCategory.findUnique({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException('Expense category not found');
    }
  }
}
