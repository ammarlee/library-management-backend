-- Allow profit percentages above 999.99 (e.g. low cost / high sell markup)
ALTER TABLE "Product" ALTER COLUMN "profitPercentage" SET DATA TYPE DECIMAL(10,2);
