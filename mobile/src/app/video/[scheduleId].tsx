import { useEffect, useState } from 'react'
import { Alert, Platform, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import { router, useLocalSearchParams } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Track } from 'livekit-client'
import { api, type VideoJoinInfo } from '@/api/api'
import { Badge, Button, Card, Loader, Screen, Title } from '@/components/ui'
import { colors, spacing, typography } from '@/theme'

declare function require(moduleName: string): unknown

type LiveKitSdk = typeof import('@livekit/react-native')

let sdkCache: LiveKitSdk | null | undefined

/**
 * LiveKit содержит нативные WebRTC-модули: в Expo Go их нет.
 * Модуль подключается лениво, чтобы отсутствие нативной сборки не ломало запуск приложения.
 */
function getLiveKit(): LiveKitSdk | null {
  if (sdkCache !== undefined) return sdkCache

  if (Constants.executionEnvironment === 'storeClient') {
    sdkCache = null
    return null
  }

  try {
    const sdk = require('@livekit/react-native') as LiveKitSdk
    if (Platform.OS !== 'web') sdk.registerGlobals()
    sdkCache = sdk
  } catch (error) {
    console.warn('[video] LiveKit недоступен в этой сборке', error)
    sdkCache = null
  }

  return sdkCache
}

export default function VideoScreen() {
  const { scheduleId } = useLocalSearchParams<{ scheduleId: string }>()
  const [connection, setConnection] = useState<VideoJoinInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sdk = getLiveKit()

  const statusQuery = useQuery({ queryKey: ['video-status'], queryFn: api.videoStatus })
  const join = useMutation({
    mutationFn: () => api.videoJoin(String(scheduleId)),
    onSuccess: (data) => {
      setError(null)
      setConnection(data)
    },
    onError: (mutationError) => setError(readError(mutationError, 'Не удалось подключиться к занятию')),
  })
  const leave = useMutation({ mutationFn: (roomId: string) => api.videoLeave(roomId) })

  const handleExit = async () => {
    if (connection) await leave.mutateAsync(connection.roomId).catch(() => undefined)
    setConnection(null)
    router.back()
  }

  if (!sdk) {
    return (
      <Screen>
        <Title>Онлайн-занятие</Title>
        <Card>
          <Text style={styles.cardTitle}>Нужна development-сборка</Text>
          <Text style={styles.muted}>
            Видеосвязь работает на нативных модулях WebRTC, которых нет в Expo Go. Соберите приложение командой
            «npx expo run:android» (или development-сборку EAS) — после этого занятие откроется прямо в приложении.
          </Text>
        </Card>
      </Screen>
    )
  }

  if (connection) {
    const Room = sdk.LiveKitRoom
    return (
      <Room
        serverUrl={connection.url}
        token={connection.token}
        audio
        video
        connect
        onError={(roomError: Error) => setError(roomError.message)}
        onDisconnected={() => setConnection(null)}
      >
        <RoomView sdk={sdk} info={connection} onExit={() => void handleExit()} />
      </Room>
    )
  }

  return (
    <Screen>
      <Title>Онлайн-занятие</Title>

      {statusQuery.isLoading ? <Loader /> : null}

      {statusQuery.data && !statusQuery.data.enabled ? (
        <Card>
          <Text style={styles.cardTitle}>Видеозанятия ещё не подключены</Text>
          <Text style={styles.muted}>
            Сервер не настроен на работу с LiveKit. Администратору нужно задать LIVEKIT_URL, LIVEKIT_API_KEY и
            LIVEKIT_API_SECRET, после чего занятия станут доступны без обновления приложения.
          </Text>
        </Card>
      ) : null}

      {statusQuery.data?.enabled ? (
        <Card>
          <Text style={styles.cardTitle}>Проверка перед подключением</Text>
          <Text style={styles.muted}>
            Приложение запросит доступ к камере и микрофону при входе. Микрофон и камеру можно выключить в любой момент
            на экране занятия.
          </Text>
          <View style={styles.row}>
            <Badge label="Камера" tone="primary" />
            <Badge label="Микрофон" tone="primary" />
            <Badge label="Чат занятия" tone="neutral" />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            title={join.isPending ? 'Подключение…' : 'Войти в занятие'}
            onPress={() => join.mutate()}
            disabled={join.isPending}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ) : null}
    </Screen>
  )
}

function RoomView({ sdk, info, onExit }: { sdk: LiveKitSdk; info: VideoJoinInfo; onExit: () => void }) {
  const room = sdk.useRoomContext()
  const participants = sdk.useParticipants()
  const cameraTracks = sdk.useTracks([{ source: Track.Source.Camera, withPlaceholder: true }])
  const VideoTrack = sdk.VideoTrack
  const [cameraOn, setCameraOn] = useState(true)
  const [microphoneOn, setMicrophoneOn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    void sdk.AudioSession.startAudioSession()
    return () => {
      void sdk.AudioSession.stopAudioSession()
    }
  }, [sdk])

  const toggleCamera = async () => {
    setBusy(true)
    try {
      await room.localParticipant.setCameraEnabled(!cameraOn)
      setCameraOn((value) => !value)
    } catch (error) {
      Alert.alert('Камера недоступна', readError(error, 'Не удалось переключить камеру'))
    } finally {
      setBusy(false)
    }
  }

  const toggleMicrophone = async () => {
    setBusy(true)
    try {
      await room.localParticipant.setMicrophoneEnabled(!microphoneOn)
      setMicrophoneOn((value) => !value)
    } catch (error) {
      Alert.alert('Микрофон недоступен', readError(error, 'Не удалось переключить микрофон'))
    } finally {
      setBusy(false)
    }
  }

  const flipCamera = async () => {
    try {
      const switched = await room.switchActiveDevice('videoinput', '')
      if (switched === false) {
        Alert.alert('Переключение недоступно', 'На этом устройстве нет второй камеры')
      }
    } catch (error) {
      Alert.alert('Переключение недоступно', readError(error, 'Не удалось переключить камеру'))
    }
  }

  const endLesson = () => {
    Alert.alert('Завершить занятие?', 'Участники будут отключены, посещаемость сохранится.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Завершить',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.videoEnd(info.roomId)
            void queryClient.invalidateQueries({ queryKey: ['schedule'] })
            await room.disconnect()
            onExit()
          } catch (error) {
            Alert.alert('Ошибка', readError(error, 'Не удалось завершить занятие'))
          }
        },
      },
    ])
  }

  const toggleRecording = async () => {
    setBusy(true)
    try {
      if (recordingId) {
        await api.videoStopRecording(info.roomId, recordingId)
        setRecordingId(null)
        Alert.alert('Запись остановлена', 'Ссылка появится после обработки записи на сервере.')
      } else {
        const recording = await api.videoStartRecording(info.roomId)
        setRecordingId(recording.id)
        Alert.alert('Запись началась', 'Предупредите участников: запись ведётся на стороне сервера.')
      }
    } catch (error) {
      Alert.alert('Запись недоступна', readError(error, 'Не удалось управлять записью'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.room}>
      <View style={styles.header}>
        <Text style={styles.roomTitle} numberOfLines={1}>
          {info.schedule.title}
        </Text>
        <Text style={styles.roomSubtitle}>
          {info.course.title} · {info.teacher} · {participants.length} участн.
        </Text>
        {recordingId ? <Badge label="● Идёт запись" tone="danger" /> : null}
      </View>

      <View style={styles.grid}>
        {cameraTracks.length === 0 ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Камеры выключены</Text>
          </View>
        ) : (
          cameraTracks.filter(sdk.isTrackReference).map((trackRef) => (
            <View key={trackRef.participant.identity} style={styles.tile}>
              <VideoTrack trackRef={trackRef} style={styles.video} objectFit="cover" />
              <Text style={styles.tileName} numberOfLines={1}>
                {trackRef.participant.name || trackRef.participant.identity}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.participants}>
        <Text style={styles.muted}>
          Участники: {participants.map((item) => item.name || item.identity).join(', ')}
        </Text>
      </View>

      <View style={styles.controls}>
        <Button
          title={microphoneOn ? 'Микрофон вкл.' : 'Микрофон выкл.'}
          variant={microphoneOn ? 'secondary' : 'primary'}
          onPress={() => void toggleMicrophone()}
          disabled={busy}
          style={styles.control}
        />
        <Button
          title={cameraOn ? 'Камера вкл.' : 'Камера выкл.'}
          variant={cameraOn ? 'secondary' : 'primary'}
          onPress={() => void toggleCamera()}
          disabled={busy}
          style={styles.control}
        />
        <Button title="Сменить камеру" variant="secondary" onPress={() => void flipCamera()} style={styles.control} />
      </View>

      {info.isModerator ? (
        <View style={styles.controls}>
          <Button
            title={recordingId ? 'Остановить запись' : 'Начать запись'}
            variant="secondary"
            onPress={() => void toggleRecording()}
            disabled={busy}
            style={styles.control}
          />
          <Button title="Завершить занятие" variant="secondary" onPress={endLesson} style={styles.control} />
        </View>
      ) : null}

      <Button title="Выйти" onPress={onExit} style={{ marginTop: spacing.sm }} />
    </View>
  )
}

function readError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error?: { message?: string } } } }).response
    const message = response?.data?.error?.message
    if (message) return message
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: typography.h2, fontWeight: '700', color: colors.text },
  muted: { fontSize: typography.caption, color: colors.textMuted },
  row: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' },
  error: { color: colors.danger, fontSize: typography.caption, marginTop: spacing.sm },
  room: { flex: 1, backgroundColor: colors.background, padding: spacing.md, gap: spacing.sm },
  header: { gap: 2 },
  roomTitle: { fontSize: typography.h1, fontWeight: '700', color: colors.text },
  roomSubtitle: { fontSize: typography.caption, color: colors.textMuted },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tile: { width: '49%', aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.card },
  video: { flex: 1, backgroundColor: '#111' },
  tileName: {
    position: 'absolute',
    bottom: 4,
    left: 6,
    right: 6,
    color: colors.white,
    fontSize: typography.tiny,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderRadius: 16 },
  placeholderText: { color: colors.textMuted },
  participants: { minHeight: 32, justifyContent: 'center' },
  controls: { flexDirection: 'row', gap: spacing.xs },
  control: { flex: 1 },
})
