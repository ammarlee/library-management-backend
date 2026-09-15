import { getPaymentScreenshotMaxBytes } from './storage.config';

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  },
  corsOrigin: process.env.CORS_ORIGIN,
  storage: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    region: process.env.AWS_REGION ?? 'us-east-2',
    paymentScreensBucket: process.env.PAYMENT_SCREENS_BUCKET ?? 'payment-screens',
    paymentScreenshotMaxBytes: getPaymentScreenshotMaxBytes(),
    signedUrlExpiresIn: parseInt(
      process.env.PAYMENT_SCREENSHOT_SIGNED_URL_EXPIRES_IN ?? '300',
      10,
    ),
  },
});
