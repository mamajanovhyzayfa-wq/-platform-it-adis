import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { router } from 'expo-router'
import { api } from '@/api/api'

/**
 * Push-уведомления через Expo Notifications.
 *
 * Приложение получает Expo-токен устройства, отправляет его на сервер
 * (`POST /users/me/push-token`), а сервер рассылает пуши о новых заданиях,
 * сообщениях, начале занятий и проверке работ. По нажатию на уведомление
 * открывается нужный экран.
 */

const DEVICE_KEY = 'itadis.device-id'

export type PushPermission = 'granted' | 'denied' | 'unsupported'

/** Android требует канал доставки; iOS канал игнорирует. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Напоминания',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: '#1B2BCF',
  })
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Сообщения',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#1B2BCF',
  })
}

/** Показываем уведомление и когда приложение открыто: так не теряются события в чате. */
export function configureNotificationHandler(): void {
  if (Platform.OS === 'web') return
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })
}

/** Стабильный идентификатор установки: привязывает токен к устройству. */
export async function getDeviceId(): Promise<string> {
  if (Platform.OS === 'web') return 'web'
  const saved = await SecureStore.getItemAsync(DEVICE_KEY)
  if (saved) return saved
  const generated = `${Platform.OS}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  await SecureStore.setItemAsync(DEVICE_KEY, generated)
  return generated
}

function platformName(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios'
  if (Platform.OS === 'android') return 'android'
  return 'web'
}

/**
 * projectId нужен Expo, чтобы выдать push-токен в development- и EAS-сборках.
 * Источник — `extra.eas.projectId` в app.json или `EXPO_PUBLIC_EAS_PROJECT_ID`.
 */
function easProjectId(): string | undefined {
  const fromConfig = Constants.expoConfig?.extra?.eas?.projectId
  if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined
}

/** Запрашивает разрешение и регистрирует токен на сервере. */
export async function ensurePushRegistered(): Promise<PushPermission> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported'

  await ensureAndroidChannel()

  const current = await Notifications.getPermissionsAsync()
  let status = current.status
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync()
    status = requested.status
  }
  if (status !== 'granted') return 'denied'

  try {
    const projectId = easProjectId()
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    await api.registerPushToken({ deviceId: await getDeviceId(), platform: platformName(), pushToken: data })
    return 'granted'
  } catch (error) {
    console.warn('[push] не удалось зарегистрировать токен', error instanceof Error ? error.message : error)
    return 'denied'
  }
}

/** Снимает токен при выходе, чтобы устройство не получало чужие уведомления. */
export async function unregisterPush(): Promise<void> {
  if (Platform.OS === 'web') return
  try {
    await api.removePushToken(await getDeviceId())
  } catch {
    // Выход не должен падать из-за недоступного API.
  }
}

/** Переход по нажатию на уведомление. */
export function openFromNotification(data: Record<string, unknown> | undefined): void {
  if (!data) return
  const type = typeof data.type === 'string' ? data.type : ''

  if (type === 'MESSAGE_RECEIVED' && typeof data.conversationId === 'string') {
    router.push({ pathname: '/messages/[id]', params: { id: data.conversationId } })
    return
  }
  if ((type === 'HOMEWORK_REVIEWED' || type === 'HOMEWORK_RETURNED') && typeof data.submissionId === 'string') {
    router.push('/homework')
    return
  }
  if (type === 'HOMEWORK_ASSIGNED' && typeof data.homeworkId === 'string') {
    router.push({ pathname: '/homework/[id]', params: { id: data.homeworkId } })
    return
  }
  if (type === 'LESSON_STARTING' || type === 'SCHEDULE_CHANGED') {
    router.push('/schedule')
    return
  }
  router.push('/notifications')
}

/** Подписка на нажатия: возвращает функцию отписки. */
export function listenNotificationPresses(): () => void {
  if (Platform.OS === 'web') return () => undefined

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown> | undefined
    openFromNotification(data)
  })

  // Холодный старт по нажатию на уведомление.
  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!response) return
      openFromNotification(response.notification.request.content.data as Record<string, unknown> | undefined)
    })
    .catch(() => undefined)

  return () => subscription.remove()
}
