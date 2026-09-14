import {
  AcademicYearStatus,
  BranchStatus,
  PrismaClient,
  ProductStatus,
  ProductType,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'Password123!';

async function main() {
  const passwordHash = await argon2.hash(DEV_PASSWORD);

  const branches = await Promise.all(
    ['Branch 1', 'Branch 2', 'Branch 3'].map((name) =>
      prisma.branch.upsert({
        where: { id: `seed-branch-${name.replace(/\s+/g, '-').toLowerCase()}` },
        update: {},
        create: {
          id: `seed-branch-${name.replace(/\s+/g, '-').toLowerCase()}`,
          name,
          address: `${name} Address`,
          phone: '01000000000',
          status: BranchStatus.ACTIVE,
        },
      }),
    ),
  );

  const admin = await prisma.user.upsert({
    where: { email: 'admin@library.local' },
    update: {},
    create: {
      email: 'admin@library.local',
      passwordHash,
      fullName: 'System Admin',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  await prisma.user.upsert({
    where: { email: 'cs@library.local' },
    update: {},
    create: {
      email: 'cs@library.local',
      passwordHash,
      fullName: 'Customer Service',
      role: UserRole.CUSTOMER_SERVICE,
      status: UserStatus.ACTIVE,
    },
  });

  for (const [index, branch] of branches.entries()) {
    await prisma.user.upsert({
      where: { email: `employee${index + 1}@library.local` },
      update: {},
      create: {
        email: `employee${index + 1}@library.local`,
        passwordHash,
        fullName: `Branch Employee ${index + 1}`,
        role: UserRole.BRANCH_EMPLOYEE,
        branchId: branch.id,
        status: UserStatus.ACTIVE,
      },
    });
  }

  const teachers = await Promise.all(
    ['Dr. Ahmed', 'Prof. Sara', 'Mr. Omar'].map((name, index) =>
      prisma.teacher.upsert({
        where: { id: `seed-teacher-${index + 1}` },
        update: {},
        create: {
          id: `seed-teacher-${index + 1}`,
          name,
        },
      }),
    ),
  );

  const studyYears = await Promise.all(
    ['Grade 1', 'Grade 2', 'Grade 3'].map((name) =>
      prisma.studyYear.upsert({
        where: { name },
        update: {},
        create: { name },
      }),
    ),
  );

  const academicYear2025 = await prisma.academicYear.upsert({
    where: { name: '2025/2026' },
    update: { status: AcademicYearStatus.ACTIVE },
    create: {
      name: '2025/2026',
      status: AcademicYearStatus.ACTIVE,
    },
  });

  await prisma.academicYear.upsert({
    where: { name: '2026/2027' },
    update: { status: AcademicYearStatus.INACTIVE },
    create: {
      name: '2026/2027',
      status: AcademicYearStatus.INACTIVE,
    },
  });

  const normalBook = await prisma.product.upsert({
    where: { id: 'seed-product-normal-book' },
    update: {},
    create: {
      id: 'seed-product-normal-book',
      name: 'Math Book',
      type: ProductType.BOOK,
      teacherId: teachers[0].id,
      studyYearId: studyYears[0].id,
      academicYearId: academicYear2025.id,
      purchasePrice: 300,
      sellingPrice: 500,
      profitPercentage: 40,
      reservationAllowed: false,
      status: ProductStatus.ACTIVE,
    },
  });

  const reservableBook = await prisma.product.upsert({
    where: { id: 'seed-product-reservable-book' },
    update: {},
    create: {
      id: 'seed-product-reservable-book',
      name: 'Science Book',
      type: ProductType.BOOK,
      teacherId: teachers[1].id,
      studyYearId: studyYears[1].id,
      academicYearId: academicYear2025.id,
      purchasePrice: 350,
      sellingPrice: 600,
      profitPercentage: 41.67,
      reservationAllowed: true,
      status: ProductStatus.ACTIVE,
    },
  });

  const reservableWithPrice = await prisma.product.upsert({
    where: { id: 'seed-product-reservation-price' },
    update: {},
    create: {
      id: 'seed-product-reservation-price',
      name: 'Upcoming Physics Book',
      type: ProductType.BOOK,
      teacherId: teachers[2].id,
      studyYearId: studyYears[2].id,
      academicYearId: academicYear2025.id,
      purchasePrice: 400,
      sellingPrice: 700,
      profitPercentage: 42.86,
      reservationAllowed: true,
      reservationPrice: 500,
      status: ProductStatus.ACTIVE,
    },
  });

  const cardProduct = await prisma.product.upsert({
    where: { id: 'seed-product-card' },
    update: {},
    create: {
      id: 'seed-product-card',
      name: 'Library Access Card',
      type: ProductType.CARD,
      teacherId: teachers[0].id,
      academicYearId: academicYear2025.id,
      purchasePrice: 50,
      sellingPrice: 100,
      profitPercentage: 50,
      reservationAllowed: false,
      status: ProductStatus.ACTIVE,
    },
  });

  const productsWithStock = [normalBook, reservableBook, cardProduct];
  for (const branch of branches) {
    for (const product of productsWithStock) {
      await prisma.inventory.upsert({
        where: {
          branchId_productId: {
            branchId: branch.id,
            productId: product.id,
          },
        },
        update: {
          physicalQuantity: 20,
          reservedQuantity: 0,
        },
        create: {
          branchId: branch.id,
          productId: product.id,
          physicalQuantity: 20,
          reservedQuantity: 0,
          lowStockThreshold: 5,
        },
      });
    }

    await prisma.inventory.upsert({
      where: {
        branchId_productId: {
          branchId: branch.id,
          productId: reservableWithPrice.id,
        },
      },
      update: {
        physicalQuantity: 0,
        reservedQuantity: 0,
      },
      create: {
        branchId: branch.id,
        productId: reservableWithPrice.id,
        physicalQuantity: 0,
        reservedQuantity: 0,
        lowStockThreshold: 5,
      },
    });
  }

  await prisma.expenseCategory.upsert({
    where: { name: 'Rent' },
    update: {},
    create: { name: 'Rent' },
  });

  await prisma.expenseCategory.upsert({
    where: { name: 'Utilities' },
    update: {},
    create: { name: 'Utilities' },
  });

  console.log('Seed completed successfully.');
  console.log('Development credentials:');
  console.log(`  Admin: admin@library.local / ${DEV_PASSWORD}`);
  console.log(`  Customer Service: cs@library.local / ${DEV_PASSWORD}`);
  console.log(`  Branch Employees: employee1@library.local .. employee3@library.local / ${DEV_PASSWORD}`);
  console.log(`  Created by admin id: ${admin.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
