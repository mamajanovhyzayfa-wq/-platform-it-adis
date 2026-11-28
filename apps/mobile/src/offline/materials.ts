import AsyncStorage from '@react-native-async-storage/async-storage'
import { Linking, Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'

/**
 * Скачанные материалы урока. Файлы лежат в documentDirectory, метаданные —
 * в AsyncStorage. При отсутствии сети открываем локальную копию.
 */
const DIR = `${FileSystem.documentDirectory ?? ''}itadis-materials/`
const INDEX_KEY = 'itadis.materials.downloads'

export interface DownloadedMaterial {
  materialId: string
  title: string
  uri: string
  mimeType: string | null
  downloadedAt: string
}

type DownloadIndex = Record<string, DownloadedMaterial>

async function readIndex(): Promise<DownloadIndex> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY)
    return raw ? (JSON.parse(raw) as DownloadIndex) : {}
  } catch {
    return {}
  }
}

function safeName(title: string, mimeType: string | null) {
  const extension =
    mimeType === 'application/pdf'
      ? '.pdf'
      : mimeType?.includes('presentation')
        ? '.pptx'
        : mimeType?.includes('word')
          ? '.docx'
          : mimeType?.startsWith('image/')
            ? `.${mimeType.split('/')[1] ?? 'jpg'}`
            : ''
  const base = title
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${base || 'material'}${extension}`
}

export async function listDownloadedMaterials(): Promise<DownloadedMaterial[]> {
  return Object.values(await readIndex()).sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt))
}

export async function downloadMaterial(material: {
  id: string
  title: string
  url: string
  mimeType: string | null
}): Promise<DownloadedMaterial> {
  if (Platform.OS === 'web') {
    throw new Error('Скачивание доступно в приложении для Android и iOS')
  }
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => undefined)
  const uri = `${DIR}${material.id}-${safeName(material.title, material.mimeType)}`
  const existing = await FileSystem.getInfoAsync(uri)
  if (!existing.exists) {
    await FileSystem.downloadAsync(material.url, uri)
  }
  const record: DownloadedMaterial = {
    materialId: material.id,
    title: material.title,
    uri,
    mimeType: material.mimeType,
    downloadedAt: new Date().toISOString(),
  }
  const index = await readIndex()
  index[material.id] = record
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index))
  return record
}

/** Открывает локальный файл. Android требует content://, iOS понимает file://. */
export async function openDownloadedMaterial(record: DownloadedMaterial) {
  const uri = Platform.OS === 'android' ? await FileSystem.getContentUriAsync(record.uri) : record.uri
  await Linking.openURL(uri)
}

/** Освобождает место при выходе из аккаунта, чтобы материалы не достались следующему. */
export async function clearDownloadedMaterials() {
  const index = await readIndex()
  await Promise.all(
    Object.values(index).map((record) =>
      FileSystem.deleteAsync(record.uri, { idempotent: true }).catch(() => undefined),
    ),
  )
  await AsyncStorage.removeItem(INDEX_KEY)
}
