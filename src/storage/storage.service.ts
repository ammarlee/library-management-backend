import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export interface UploadedPaymentScreenshot {
  file_url: string;
  mime_type: string;
  key: string;
}

@Injectable()
export class StorageService {
  private readonly s3: S3Client | null;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly maxBytes: number;
  private readonly signedUrlExpiresIn: number;

  constructor(private readonly config: ConfigService) {
    this.bucket =
      this.config.get<string>('storage.paymentScreensBucket') ??
      'payment-screens';
    this.endpoint = (
      this.config.get<string>('storage.endpoint') ??
      process.env.AWS_ENDPOINT_URL_S3 ??
      ''
    ).replace(/\/$/, '');
    this.maxBytes = this.config.getOrThrow<number>(
      'storage.paymentScreenshotMaxBytes',
    );
    this.signedUrlExpiresIn =
      this.config.get<number>('storage.signedUrlExpiresIn') ?? 300;

    const accessKeyId =
      this.config.get<string>('storage.accessKeyId') ??
      process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      this.config.get<string>('storage.secretAccessKey') ??
      process.env.AWS_SECRET_ACCESS_KEY;
    const region =
      this.config.get<string>('storage.region') ??
      process.env.AWS_REGION ??
      'us-east-2';

    this.s3 =
      accessKeyId && secretAccessKey && this.endpoint
        ? new S3Client({
            region,
            endpoint: this.endpoint,
            forcePathStyle: true,
            credentials: {
              accessKeyId,
              secretAccessKey,
            },
          })
        : null;
  }

  async getSignedUrl(key: string, expiresIn = this.signedUrlExpiresIn) {
    if (!key?.trim()) {
      throw new BadRequestException('Storage key is required');
    }

    if (!this.s3) {
      throw new ServiceUnavailableException(
        'Object storage is not configured on the server',
      );
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3, command, { expiresIn });
  }

  guessMimeTypeFromKey(key: string): string {
    const extension = key.split('.').pop()?.toLowerCase() ?? 'jpg';
    return EXTENSION_TO_MIME[extension] ?? 'image/jpeg';
  }

  async uploadPaymentScreenshot(
    file: Express.Multer.File,
  ): Promise<UploadedPaymentScreenshot> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Only JPEG, PNG and WebP images are allowed',
      );
    }

    if (file.size > this.maxBytes) {
      throw new BadRequestException(
        `File size must be ${Math.round(this.maxBytes / 1024)} KB or less`,
      );
    }

    if (!this.s3 || !this.endpoint) {
      throw new ServiceUnavailableException(
        'Object storage is not configured on the server',
      );
    }

    const extension = MIME_TO_EXTENSION[file.mimetype] ?? 'jpg';
    const key = `payments/${randomUUID()}/payment-screenshot.${extension}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    const file_url = await this.getSignedUrl(key);

    return {
      file_url,
      mime_type: file.mimetype,
      key,
    };
  }
}
