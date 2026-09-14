import { UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

jest.mock('argon2');
jest.mock('@nestjs/jwt', () => ({
  JwtService: jest.fn().mockImplementation(() => ({
    signAsync: jest.fn(),
  })),
}));

import { AuthService } from './auth.service';

describe('AuthService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('token'),
  };

  let service: AuthService;

  beforeEach(() => {
    service = new AuthService(prisma as never, jwtService as never);
    jest.clearAllMocks();
  });

  it('logs in active user with valid password', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@library.local',
      passwordHash: 'hash',
      fullName: 'Admin',
      phone: null,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      branchId: null,
    });

    (argon2.verify as jest.Mock).mockResolvedValue(true);

    const result = await service.login({
      email: 'admin@library.local',
      password: 'Password123!',
    });

    expect(result.accessToken).toBe('token');
    expect(result.user.email).toBe('admin@library.local');
  });

  it('rejects inactive user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@library.local',
      passwordHash: 'hash',
      fullName: 'Admin',
      phone: null,
      role: UserRole.ADMIN,
      status: UserStatus.INACTIVE,
      branchId: null,
    });

    await expect(
      service.login({
        email: 'admin@library.local',
        password: 'Password123!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
