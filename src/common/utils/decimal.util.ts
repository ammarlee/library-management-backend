import { Decimal } from '@prisma/client/runtime/library';

export function toDecimal(value: number | string | Decimal): Decimal {
  return new Decimal(value);
}

export function multiplyDecimal(
  unitPrice: Decimal,
  quantity: number,
): Decimal {
  return unitPrice.mul(quantity);
}

export function sumDecimals(...values: Decimal[]): Decimal {
  return values.reduce((acc, value) => acc.add(value), new Decimal(0));
}

export function isPositive(value: Decimal): boolean {
  return value.gt(0);
}

export function isZeroOrPositive(value: Decimal): boolean {
  return value.gte(0);
}
