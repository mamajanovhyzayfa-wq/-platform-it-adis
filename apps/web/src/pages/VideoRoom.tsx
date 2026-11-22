import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Client,
  TrackLabel,
  type AudioTrack,
  type Peer,
  type Track,
  type PeerTrack,
  type PayloadOfPublishedMedia,
  type ProducePermissionsChangedPayload,
  type VideoTrack,
} from '@livedigital/client'
import { schedulingApi } from '../api/scheduling'
import { errorMessage, getSession } from '../api/client'
import { PageHeader, formatDateTime, formatTime } from '../components/ui'

type RemoteStream = { key: string; peerId: string; name: string; kind: string; stream: MediaStream }
type MediaKind = 'microphone' | 'camera'
const MEDIA_LABELS = { microphone: TrackLabel.Microphone, camera: TrackLabel.Camera } as const

/** Комната LiveDigital: Web SDK, камера, микрофон, экран, чат, запись и завершение. */
export function VideoRoomPage() {
  const { id = '' } = useParams()
  const session = getSession()
  const role = session?.role
  const queryClient = useQueryClient()
  const schedule = useQuery({ queryKey: ['schedule-detail', id], queryFn: () => schedulingApi.schedule(id) })
  const detail = schedule.data
  const isStaff = role === 'ADMIN' || role === 'MANAGER' || role === 'TEACHER'
  const [client, setClient] = useState<Client | null>(null)
  const [joining, setJoining] = useState(false)
  const [joined, setJoined] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [participants, setParticipants] = useState<
    Array<{ id: string; name: string; moderator: boolean; micAllowed: boolean; cameraAllowed: boolean }>
  >([])
  const [remote, setRemote] = useState<RemoteStream[]>([])
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [chat, setChat] = useState<Array<{ id: string; body: string; createdAt: string; user: { name: string; role: string } }>>([])
  const [message, setMessage] = useState('')
  const [analytics, setAnalytics] = useState<unknown>(null)
  const localVideo = useRef<HTMLVideoElement | null>(null)
  const tracks = useRef<{ camera?: VideoTrack; microphone?: AudioTrack; screen: Track[] }>({ screen: [] })
  const peers = useRef(new Map<string, Peer>())
  const attached = useRef(new Set<string>())
  const joinedRef = useRef(false)

  const canRecord = isStaff
  const durationLabel = useMemo(() => {
    if (!detail) return ''
    return `${formatTime(detail.startsAt)}–${formatTime(detail.endsAt)}`
  }, [detail])

  useEffect(() => {
    if (localVideo.current && localStream) {
      localVideo.current.srcObject = localStream
      void localVideo.current.play().catch(() => undefined)
    }
  }, [localStream])

  const chatQuery = useQuery({
    queryKey: ['lesson-chat', id],
    queryFn: () => schedulingApi.chat(id),
    enabled: joined,
    refetchInterval: 4000,
  })
  useEffect(() => {
    if (chatQuery.data) setChat(chatQuery.data)
  }, [chatQuery.data])

  useEffect(() => () => {
    if (!client) return
    const wasJoined = joinedRef.current
    joinedRef.current = false
    void client.leave().catch(() => undefined)
    // Фиксируем выход при переходе на другую страницу, а не только по кнопке.
    if (wasJoined) void schedulingApi.leaveVideo(id).catch(() => undefined)
  }, [client, id])

  const addRemoteTrack = (peer: Peer, track: PeerTrack) => {
    const stream = new MediaStream([track.mediaStreamTrack])
    const name = String(peer.appData?.displayName ?? 'Участник')
    const key = `${peer.id}:${track.mediaStreamTrack.id}`
    setRemote((items) => [
      ...items.filter((item) => item.key !== key),
      { key, peerId: peer.id, name, kind: track.kind, stream },
    ])
  }

  const permissionsOf = (peer: Peer) => ({
    micAllowed: peer.producePermissions.includes(TrackLabel.Microphone),
    cameraAllowed: peer.producePermissions.includes(TrackLabel.Camera),
  })

  const attachPeer = (peer: Peer) => {
    if (peer.isMe) return
    peers.current.set(peer.id, peer)
    const permissions = permissionsOf(peer)
    setParticipants((items) => [
      ...items.filter((item) => item.id !== peer.id),
      {
        id: peer.id,
        name: String(peer.appData?.displayName ?? 'Участник'),
        moderator: peer.isModerator,
        ...permissions,
      },
    ])
    if (attached.current.has(peer.id)) return
    attached.current.add(peer.id)
    peer.observer.on('media-published', (media: PayloadOfPublishedMedia) => {
      void peer.subscribe({ producerId: media.producerId }).catch(() => undefined)
    })
    peer.observer.on('track-start', (track: PeerTrack) => addRemoteTrack(peer, track))
    peer.observer.on('track-end', (track: PeerTrack) => {
      setRemote((items) => items.filter((item) => !(item.peerId === peer.id && item.stream.getTracks()[0]?.id === track.mediaStreamTrack.id)))
    })
    peer.observer.on('produce-permissions-changed', (payload: ProducePermissionsChangedPayload) => {
      setParticipants((items) =>
        items.map((item) =>
          item.id === peer.id
            ? {
                ...item,
                micAllowed: payload.labels.includes(TrackLabel.Microphone),
                cameraAllowed: payload.labels.includes(TrackLabel.Camera),
              }
            : item,
        ),
      )
    })
    for (const media of peer.publishedMedia) {
      void peer.subscribe({ producerId: media.producerId }).catch(() => undefined)
    }
  }

  const join = async () => {
    setJoining(true)
    setError(null)
    try {
      const credentials = await schedulingApi.joinVideo(id)
      const instance = new Client({})
      instance.observer.on('peer-joined', attachPeer)
      instance.observer.on('peer-left', (peerId: string) => {
        peers.current.delete(peerId)
        attached.current.delete(peerId)
        setParticipants((items) => items.filter((item) => item.id !== peerId))
        setRemote((items) => items.filter((item) => item.peerId !== peerId))
      })
      instance.observer.on('channel-state-synced', () => {
        for (const peer of instance.peers) attachPeer(peer)
      })
      instance.observer.on('reject-unauthorized', () => setError('LiveDigital отклонил токен. Обновите страницу и войдите снова.'))
      instance.observer.on('connection-lost', () => setNotice('Связь с сервером потеряна, переподключаемся…'))
      instance.observer.on('connection-restored', () => setNotice(null))
      let rejoining: Promise<void> | null = null
      const rejoin = () => {
        // После channel-rejoin-required старый signaling-токен уже непригоден.
        rejoining ??= (async () => {
          try {
            const fresh = await schedulingApi.joinVideo(id)
            await instance.join({ token: fresh.signalingToken })
            await instance.requestChannelStateSync()
            setNotice('Соединение с комнатой восстановлено.')
          } catch (rejoinError) {
            setError(errorMessage(rejoinError, 'Не удалось восстановить соединение с LiveDigital'))
          } finally {
            rejoining = null
          }
        })()
        return rejoining
      }
      instance.observer.on('channel-rejoin-required', () => void rejoin())
      await instance.join({ token: credentials.signalingToken })
      await instance.requestChannelStateSync()
      setClient(instance)
      joinedRef.current = true
      setJoined(true)
      if (credentials.autoRecording?.started) setRecording(true)

      let mediaWarning: string | null = null
      try {
        const microphone = await instance.createMicrophoneAudioTrack({ noiseSuppression: true })
        await microphone.publish()
        tracks.current.microphone = microphone
        const camera = await instance.createCameraVideoTrack()
        await camera.publish()
        tracks.current.camera = camera
        const stream = new MediaStream()
        const cameraTrack = camera.mediaStreamTrack
        if (cameraTrack) stream.addTrack(cameraTrack)
        const micTrack = microphone.mediaStreamTrack
        if (micTrack && !stream.getAudioTracks().length) stream.addTrack(micTrack)
        setLocalStream(stream)
      } catch (mediaError) {
        mediaWarning = `камера или микрофон недоступны: ${errorMessage(mediaError, 'нет доступа')}`
      }

      const notes = ['Подключено.']
      if (credentials.autoRecording?.started) notes.push('Запись запущена автоматически.')
      if (credentials.autoRecording?.warning) notes.push(`Автозапись не запущена: ${credentials.autoRecording.warning}`)
      if (mediaWarning) notes.push(mediaWarning)
      setNotice(notes.join(' '))
    } catch (joinError) {
      setError(errorMessage(joinError, 'Не удалось подключиться к LiveDigital'))
    } finally {
      setJoining(false)
    }
  }

  const leave = async (endCall = false) => {
    setJoining(true)
    try {
      if (client) {
        for (const track of [tracks.current.camera, tracks.current.microphone, ...tracks.current.screen]) {
          if (track) await client.deleteTrack(track).catch(() => undefined)
        }
        await client.leave().catch(() => undefined)
      }
      if (recording) await schedulingApi.stopRecording(id).catch(() => undefined)
      if (endCall) await schedulingApi.endVideo(id)
      else await schedulingApi.leaveVideo(id).catch(() => undefined)
      tracks.current = { screen: [] }
      peers.current.clear()
      attached.current.clear()
      setClient(null)
      setJoined(false)
      joinedRef.current = false
      setParticipants([])
      setRemote([])
      setLocalStream(null)
      setScreenStream(null)
      setSharing(false)
      setRecording(false)
      queryClient.invalidateQueries({ queryKey: ['schedule-detail', id] })
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
    } catch (leaveError) {
      setError(errorMessage(leaveError, 'Не удалось завершить занятие'))
    } finally {
      setJoining(false)
    }
  }

  const toggleMic = async () => {
    const track = tracks.current.microphone
    if (!track) return
    if (micOn) await track.pause()
    else await track.resume()
    setMicOn((value) => !value)
  }
  const toggleCamera = async () => {
    const track = tracks.current.camera
    if (!track) return
    if (cameraOn) await track.pause()
    else await track.resume()
    setCameraOn((value) => !value)
  }
  const toggleScreen = async () => {
    if (!client) return
    if (sharing) {
      for (const track of tracks.current.screen) {
        await client.deleteTrack(track).catch(() => undefined)
      }
      tracks.current.screen = []
      setScreenStream(null)
      setSharing(false)
      return
    }
    try {
      const screenTracks = await client.createScreenMediaTracks()
      for (const track of screenTracks) await track.publish()
      tracks.current.screen = screenTracks
      const stream = new MediaStream(screenTracks.map((track) => track.mediaStreamTrack).filter(Boolean))
      setScreenStream(stream)
      setSharing(true)
    } catch (screenError) {
      setError(errorMessage(screenError, 'Не удалось начать демонстрацию экрана'))
    }
  }

  const toggleRecording = async () => {
    setError(null)
    try {
      if (recording) {
        await schedulingApi.stopRecording(id)
        setRecording(false)
      } else {
        await schedulingApi.startRecording(id)
        setRecording(true)
      }
      queryClient.invalidateQueries({ queryKey: ['schedule-detail', id] })
    } catch (recordError) {
      setError(errorMessage(recordError, 'Не удалось изменить запись'))
    }
  }

  const send = async () => {
    const text = message.trim()
    if (!text) return
    setMessage('')
    try {
      await schedulingApi.sendChat(id, text)
      const items = await schedulingApi.chat(id)
      setChat(items)
    } catch (sendError) {
      setError(errorMessage(sendError, 'Не удалось отправить сообщение'))
    }
  }

  const togglePeerMedia = async (peerId: string, kind: MediaKind) => {
    const peer = peers.current.get(peerId)
    if (!peer) return
    const label = MEDIA_LABELS[kind]
    try {
      const allowed = peer.hasPermission(label)
      if (allowed) await peer.removeProducePermission(label)
      else await peer.addProducePermission(label)
      setNotice(
        allowed
          ? `Участнику запрещено использовать ${kind === 'microphone' ? 'микрофон' : 'камеру'}`
          : `Участнику разрешено использовать ${kind === 'microphone' ? 'микрофон' : 'камеру'}`,
      )
    } catch (muteError) {
      setError(errorMessage(muteError, 'Не удалось изменить права участника'))
    }
  }

  if (schedule.isLoading) return <div className="card state">Загрузка занятия…</div>
  if (schedule.error) return <div className="card alert alert-error">{errorMessage(schedule.error)}</div>
  if (!detail) return null

  return (
    <div className="stack">
      <PageHeader
        title={detail.title}
        subtitle={`${detail.course.title} · ${formatDateTime(detail.startsAt)} · ${durationLabel} · LiveDigital`}
        actions={<Link className="button button-ghost" to="/calendar">К календарю</Link>}
      />
      {error ? <div className="alert alert-error">{error}</div> : null}
      {notice ? <div className="alert alert-info">{notice}</div> : null}

      {!joined ? (
        <div className="card stack-sm">
          <h2>Видеокомната</h2>
          <p className="muted">
            Комната создаётся на сервере ITadis; токен участника подписывается backend и действует только для этого занятия.
            {detail.deliveryMode === 'OFFLINE' ? ' Занятие офлайн — видеокомната не требуется.' : ''}
          </p>
          <ul className="list">
            <li><span>Провайдер</span><span>{detail.video?.provider ?? 'LiveDigital'}</span></li>
            <li><span>Статус комнаты</span><span>{detail.video?.status ?? 'не создана'}</span></li>
            <li><span>Запись</span><span>{detail.recordingEnabled ? 'включена' : 'выключена'}{detail.autoRecord ? ' · автостарт' : ''}</span></li>
          </ul>
          <button className="button" type="button" onClick={() => void join()} disabled={joining || detail.status === 'CANCELLED'}>
            {joining ? 'Подключаемся…' : 'Подключиться'}
          </button>
          {detail.status === 'CANCELLED' ? <p className="muted small">Занятие отменено: {detail.cancellationReason}</p> : null}
          {detail.recordingEnabled === false ? <p className="muted small">Запись отключена настройками занятия или группы.</p> : null}
        </div>
      ) : (
        <div className="video-layout">
          <div className="video-main">
            <div className="video-stage">
              {screenStream ? (
                <RemoteVideo stream={screenStream} name="Ваш экран" />
              ) : localStream ? (
                <video ref={localVideo} className="video-tile" muted playsInline autoPlay />
              ) : (
                <div className="video-placeholder">Камера выключена</div>
              )}
              <div className="video-remote-grid">
                {remote.filter((item) => item.kind === 'video').map((item) => (
                  <RemoteVideo key={item.key} stream={item.stream} name={item.name} />
                ))}
                {remote.filter((item) => item.kind !== 'video').map((item) => (
                  <audio
                    key={item.key}
                    autoPlay
                    ref={(element) => {
                      if (element && element.srcObject !== item.stream) element.srcObject = item.stream
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="video-controls">
              <button className={micOn ? 'button button-ghost' : 'button button-danger'} type="button" onClick={() => void toggleMic()}>
                {micOn ? 'Микрофон вкл.' : 'Микрофон выкл.'}
              </button>
              <button className={cameraOn ? 'button button-ghost' : 'button button-danger'} type="button" onClick={() => void toggleCamera()}>
                {cameraOn ? 'Камера вкл.' : 'Камера выкл.'}
              </button>
              <button className={sharing ? 'button' : 'button button-ghost'} type="button" onClick={() => void toggleScreen()}>
                {sharing ? 'Остановить показ' : 'Показать экран'}
              </button>
              {canRecord ? (
                <button className={recording ? 'button button-danger' : 'button button-ghost'} type="button" onClick={() => void toggleRecording()}>
                  {recording ? 'Остановить запись' : 'Записать'}
                </button>
              ) : null}
              {canRecord ? (
                <button className="button button-danger" type="button" onClick={() => void leave(true)} disabled={joining}>
                  Завершить занятие
                </button>
              ) : (
                <button className="button button-ghost" type="button" onClick={() => void leave(false)} disabled={joining}>
                  Выйти
                </button>
              )}
            </div>
          </div>

          <aside className="video-side stack-sm">
            <div className="card stack-sm">
              <h3>Участники ({participants.length + 1})</h3>
              <ul className="list">
                <li><span>{session?.firstName ?? 'Вы'} {session?.lastName ?? ''} · вы</span><span className="muted small">{isStaff ? 'наставник' : 'ученик'}</span></li>
                {participants.map((participant) => (
                  <li key={participant.id}>
                    <span>{participant.name}{participant.moderator ? ' · модератор' : ''}</span>
                    {isStaff ? (
                      <span className="row-actions">
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => void togglePeerMedia(participant.id, 'microphone')}
                        >
                          {participant.micAllowed ? 'Запретить микрофон' : 'Разрешить микрофон'}
                        </button>
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => void togglePeerMedia(participant.id, 'camera')}
                        >
                          {participant.cameraAllowed ? 'Запретить камеру' : 'Разрешить камеру'}
                        </button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {isStaff ? (
                <button
                  className="button button-ghost button-small"
                  type="button"
                  onClick={async () => {
                    try {
                      setAnalytics(await schedulingApi.videoAnalytics(id))
                    } catch (analyticsError) {
                      setError(errorMessage(analyticsError, 'Аналитика LiveDigital недоступна на этом тарифе'))
                    }
                  }}
                >
                  Аналитика занятия
                </button>
              ) : null}
              {analytics ? <pre className="code-block">{JSON.stringify(analytics, null, 2)}</pre> : null}
            </div>

            <div className="card stack-sm">
              <h3>Чат занятия</h3>
              <div className="chat-list">
                {chat.length === 0 ? <p className="muted small">Сообщений нет.</p> : chat.map((item) => (
                  <div className="chat-message" key={item.id}>
                    <strong>{item.user.name}</strong>
                    <span className="muted small"> · {formatTime(item.createdAt)}</span>
                    <p>{item.body}</p>
                  </div>
                ))}
              </div>
              <form
                className="row-actions"
                onSubmit={(event) => {
                  event.preventDefault()
                  void send()
                }}
              >
                <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Сообщение" />
                <button className="button button-small" type="submit">Отправить</button>
              </form>
              <p className="muted small">Чат сохраняется в ITadis и доступен участникам занятия после урока.</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function RemoteVideo({ stream, name }: { stream: MediaStream; name: string }) {
  return (
    <div className="video-remote">
      <video
        className="video-tile"
        autoPlay
        playsInline
        ref={(element) => {
          if (element && element.srcObject !== stream) {
            element.srcObject = stream
            void element.play().catch(() => undefined)
          }
        }}
      />
      <span className="video-name">{name}</span>
    </div>
  )
}
