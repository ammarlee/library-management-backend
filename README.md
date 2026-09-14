# Library Management API

Production-ready NestJS REST API for a multi-branch library and book-selling business.

## Stack

- NestJS + TypeScript
- PostgreSQL + Prisma ORM
- JWT authentication
- Argon2 password hashing
- class-validator / class-transformer
- Swagger (development)

## Setup

1. Copy environment file:

```bash
cp .env.example .env
```

2. Update `DATABASE_URL`, `JWT_SECRET`, and other values in `.env`.

3. Install dependencies:

```bash
npm install
```

4. Run migrations and seed:

```bash
npx prisma migrate dev --name init
npx prisma db seed
```

5. Start development server:

```bash
npm run start:dev
```

Swagger docs: `http://localhost:3000/docs`

## Development credentials (seed)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@library.local | Password123! |
| Customer Service | cs@library.local | Password123! |
| Branch Employee 1 | employee1@library.local | Password123! |
| Branch Employee 2 | employee2@library.local | Password123! |
| Branch Employee 3 | employee3@library.local | Password123! |

## Scripts

```bash
npm run start:dev      # Development server
npm run build          # Compile TypeScript
npm test               # Unit tests
npx prisma studio      # Database GUI
npx prisma migrate dev # Create/apply migrations
npx prisma db seed     # Seed development data
```

## Architecture

```text
Controller → Service → InventoryOperations / Prisma → PostgreSQL
```

Critical financial and inventory operations run inside Prisma transactions.

## Main modules

- Auth, Users, Branches, Teachers, Study Years, Academic Years
- Students (with audit logs)
- Products, Inventory (with stock movement ledger)
- Reservations (create, deliver, cancel, change product)
- Sales, Returns, Exchanges
- Expenses, Reports

## Authorization

| Role | Scope |
|------|-------|
| ADMIN | Full access |
| CUSTOMER_SERVICE | Students, reservations (any branch), own reservation reports |
| BRANCH_EMPLOYEE | Own branch sales, reservations, delivery, branch reports |

Branch employees never trust `branchId` from the frontend — the backend uses `authenticatedUser.branchId`.

## Environment variables

```env
DATABASE_URL=
JWT_SECRET=
JWT_EXPIRES_IN=8h
PORT=3000
```
