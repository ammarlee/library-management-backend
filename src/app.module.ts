import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AcademicYearsModule } from './academic-years/academic-years.module';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { ExchangesModule } from './exchanges/exchanges.module';
import { ExpensesModule } from './expenses/expenses.module';
import { InventoryModule } from './inventory/inventory.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { ReportsModule } from './reports/reports.module';
import { ReservationsModule } from './reservations/reservations.module';
import { ReturnsModule } from './returns/returns.module';
import { SalesModule } from './sales/sales.module';
import { StudentsModule } from './students/students.module';
import { StudyYearsModule } from './study-years/study-years.module';
import { TeachersModule } from './teachers/teachers.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    BranchesModule,
    TeachersModule,
    StudyYearsModule,
    AcademicYearsModule,
    StudentsModule,
    ProductsModule,
    InventoryModule,
    ReservationsModule,
    SalesModule,
    ReturnsModule,
    ExchangesModule,
    ExpensesModule,
    ReportsModule,
    UploadsModule,
  ],
})
export class AppModule {}
