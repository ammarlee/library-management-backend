import { BadRequestException } from '@nestjs/common';
import { AcademicYearStatus } from '@prisma/client';
import { AcademicYearsService } from './academic-years.service';

describe('AcademicYearsService', () => {
  const prisma = {
    academicYear: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: AcademicYearsService;

  beforeEach(() => {
    service = new AcademicYearsService(prisma as never);
    jest.clearAllMocks();
  });

  it('rejects activating already active academic year', async () => {
    prisma.academicYear.findUnique.mockResolvedValue({
      id: 'year-1',
      name: '2025/2026',
      status: AcademicYearStatus.ACTIVE,
    });

    await expect(service.activate('year-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('activates academic year in transaction', async () => {
    prisma.academicYear.findUnique.mockResolvedValue({
      id: 'year-2',
      name: '2026/2027',
      status: AcademicYearStatus.INACTIVE,
    });

    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        academicYear: {
          updateMany: jest.fn(),
          update: jest.fn().mockResolvedValue({
            id: 'year-2',
            status: AcademicYearStatus.ACTIVE,
          }),
        },
      }),
    );

    const result = await service.activate('year-2');
    expect(result.status).toBe(AcademicYearStatus.ACTIVE);
  });
});
