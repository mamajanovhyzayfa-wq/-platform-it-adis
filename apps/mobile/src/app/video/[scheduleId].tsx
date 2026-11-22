import { useMemo, useState } from 'react'
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { API_URL } from '@/api/client'
import { getAccessToken, getRefreshToken } from '@/api/session'
import { useAuthStore } from '@/store/auth'
import { colors, spacing, typography } from '@/theme'

/**
 * Мобильная видеокомната LiveDigital.
 *
 * У LiveDigital нет React Native-пакета: официальные iOS/Android SDK требуют
 * отдельного нативного экрана и моста в Expo. Поэтому в приложении используется
 * официальный Web SDK LiveDigital внутри нативного WebView — полноценные
 * камера, микрофон, демонстрация экрана, чат и запись, без LiveKit/iframe-провайдера.
 */

function webRoomUrl(scheduleId: string): string {
  const configured = (process.env.EXPO_PUBLIC_WEB_URL ?? '').replace(/\/+$/, '')
  const base = (configured || API_URL.replace(/\/api\/?$/, '').replace(/\/+$/, '')).replace(/\/+$/, '')
  const path = base.endsWith('/app') ? `/lesson/${encodeURIComponent(scheduleId)}` : `/app/lesson/${encodeURIComponent(scheduleId)}`
  return `${base}${path}`
}

function bootstrapScript(input: {
  token: string
  refreshToken: string
  user: unknown
}): string {
  const token = JSON.stringify(input.token)
  const refreshToken = JSON.stringify(input.refreshToken)
  const user = JSON.stringify(JSON.stringify(input.user))
  const apiUrl = JSON.stringify(API_URL)

  return `(function () {
  try {
    localStorage.setItem('itadis.admin.token', ${token});
    localStorage.setItem('itadis.admin.user', ${user});
    localStorage.setItem('itadis.admin.refresh', ${refreshToken});
  } catch (e) {}

  var apiUrl = ${apiUrl};
  if (apiUrl.charAt(0) === '/') apiUrl = window.location.origin + apiUrl;

  async function refreshSession() {
    try {
      var accessToken = localStorage.getItem('itadis.admin.token');
      var refreshToken = localStorage.getItem('itadis.admin.refresh');
      if (!accessToken || !refreshToken) return;

      var expiresAt = 0;
      try {
        var payload = JSON.parse(atob((accessToken.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/')));
        expiresAt = payload.exp ? payload.exp * 1000 : 0;
      } catch (e) {}
      if (expiresAt && expiresAt - Date.now() > 120000) return;

      var response = await fetch(apiUrl + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken })
      });
      if (!response.ok) return;
      var data = await response.json();
      if (!data || !data.tokens || !data.tokens.accessToken || !data.tokens.refreshToken) return;

      localStorage.setItem('itadis.admin.token', data.tokens.accessToken);
      localStorage.setItem('itadis.admin.refresh', data.tokens.refreshToken);
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'tokens',
          accessToken: data.tokens.accessToken,
          refreshToken: data.tokens.refreshToken
        }));
      }
    } catch (e) {}
  }

  setTimeout(refreshSession, 1500);
  setInterval(refreshSession, 60000);
})();
true;`
}

export default function VideoScreen() {
  const { scheduleId } = useLocalSearchParams<{ scheduleId: string }>()
  const insets = useSafeAreaInsets()
  const user = useAuthStore((state) => state.user)
  const status = useAuthStore((state) => state.status)
  const updateTokens = useAuthStore((state) => state.updateTokens)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const token = getAccessToken()
  const refreshToken = getRefreshToken()
  const roomUrl = useMemo(() => webRoomUrl(String(scheduleId)), [scheduleId])
  const injected = useMemo(
    () =>
      token && refreshToken && user
        ? bootstrapScript({
            token,
            refreshToken,
            user: { ...user, primaryRole: user.role },
          })
        : '',
    [token, refreshToken, user],
  )

  if (status === 'loading' || status === 'idle') {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  if (!token || !refreshToken || !user) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Требуется вход</Text>
        <Text style={styles.muted}>Войдите в ITadis заново, чтобы открыть видеозанятие.</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/login')}>
          <Text style={styles.buttonText}>Ко входу</Text>
        </Pressable>
      </View>
    )
  }

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string
        accessToken?: string
        refreshToken?: string
      }
      if (data.type === 'tokens' && data.accessToken && data.refreshToken) {
        void updateTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
      }
    } catch {
      // Сообщения другого формата игнорируем.
    }
  }

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Онлайн-занятие</Text>
        <Text style={styles.muted}>Откройте видеокомнату в браузере: камера и микрофон будут доступны.</Text>
        <Pressable style={styles.button} onPress={() => void Linking.openURL(roomUrl)}>
          <Text style={styles.buttonText}>Открыть комнату</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>Назад</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Онлайн-занятие
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.webviewWrap}>
        <WebView
          source={{ uri: roomUrl }}
          style={styles.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          mixedContentMode="compatibility"
          setSupportMultipleWindows={false}
          injectedJavaScriptBeforeContentLoaded={injected}
          onMessage={handleMessage}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={(event) => {
            setLoading(false)
            setError(
              `Не удалось открыть видеокомнату: ${event.nativeEvent.description}. Проверьте EXPO_PUBLIC_WEB_URL и доступ к серверу.`,
            )
          }}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 400) {
              setLoading(false)
              setError(`Сервер видеокомнаты вернул ${event.nativeEvent.statusCode}.`)
            }
          }}
        />
        {loading ? (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Подключаемся к LiveDigital…</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  back: { color: colors.primary, fontSize: typography.body, fontWeight: '600', minWidth: 64 },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: typography.body, fontWeight: '700' },
  headerSpacer: { minWidth: 64 },
  webviewWrap: { flex: 1 },
  webview: { flex: 1, backgroundColor: colors.background },
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  title: { color: colors.text, fontSize: typography.h2, fontWeight: '700', textAlign: 'center' },
  muted: { color: colors.textMuted, fontSize: typography.caption, textAlign: 'center' },
  error: { color: colors.danger, fontSize: typography.caption, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  button: {
    marginTop: spacing.sm,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
  },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: typography.body },
})
