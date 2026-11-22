import { HeadBucketCommand } from '@aws-sdk/client-s3'
import { env } from '../../config/env.js'
import { getS3Client, isS3Configured } from '../../lib/file-storage.js'
import { safeErrorMessage } from '../core/errors.js'
import { missingVariables } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

function missing(): string[] {
  return missingVariables([
    ['S3_ENDPOINT', env.S3_ENDPOINT],
    ['S3_BUCKET', env.S3_BUCKET],
    ['S3_ACCESS_KEY', env.S3_ACCESS_KEY],
    ['S3_SECRET_KEY', env.S3_SECRET_KEY],
  ])
}

/**
 * Облачное хранилище (S3-совместимое): библиотека файлов, вложения и резервные копии.
 * Без S3 проект использует локальный каталог STORAGE_DIR — адаптер сообщает
 * об этом как о ненастроенной облачной интеграции, а не имитирует успех.
 */
export const storageAdapter: IntegrationAdapter = {
  descriptor: {
    id: 's3',
    name: 'Облачное хранилище (S3)',
    category: 'storage',
    description: 'Библиотека файлов, вложения заданий и резервные копии в объектном хранилище.',
    docsUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html',
    envVars: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_REGION'],
  },
  missingEnv: missing,
  isConfigured: () => isS3Configured(),
  async probe(): Promise<IntegrationProbe> {
    try {
      await getS3Client().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET! }))
      return { ok: true }
    } catch (error) {
      return { ok: false, message: `S3: ${safeErrorMessage(error, 160)}` }
    }
  },
}
