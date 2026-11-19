import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AchievementItem } from '@/api/api'
import { Badge, Card, EmptyState, Loader, Screen, Title } from '@/components/ui'
import { useI18n } from '@/i18n'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

/** Достижения: прогресс по условиям, которые проверяет сервер. */
export default function AchievementsScreen() {
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)
  const queryClient = useQueryClient()
  const achievements = useQuery({ queryKey: ['achievements'], queryFn: api.achievements })

  // Пересчёт на сервере: выданные достижения сразу появляются в списке.
  useEffect(() => {
    let active = true
    api
      .checkAchievements()
      .then((result) => {
        if (active && result.awarded.length > 0) {
          void queryClient.invalidateQueries({ queryKey: ['achievements'] })
          void queryClient.invalidateQueries({ queryKey: ['profile'] })
          void queryClient.invalidateQueries({ queryKey: ['notifications'] })
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [queryClient])

  return (
    <Screen>
      <Title>{t('achievements.title')}</Title>

      {achievements.isLoading ? <Loader /> : null}
      {achievements.error ? <Text style={styles.error}>{t('common.error')}</Text> : null}

      {achievements.data ? (
        <Text style={styles.summary}>
          {t('achievements.summary')} {achievements.data.earned} {t('achievements.from')} {achievements.data.total}
        </Text>
      ) : null}

      {achievements.data && achievements.data.items.length === 0 ? (
        <EmptyState title={t('achievements.empty')} hint={t('achievements.emptyHint')} />
      ) : null}

      {achievements.data?.items.map((item) => <AchievementCard key={item.id} item={item} />)}
    </Screen>
  )
}

function AchievementCard({ item }: { item: AchievementItem }) {
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)
  const percent = Math.round((item.current / Math.max(1, item.target)) * 100)
  const earned = Boolean(item.earnedAt)

  return (
    <Card>
      <View style={styles.rowBetween}>
        <Text style={styles.title}>{item.title}</Text>
        <Badge label={earned ? t('achievements.earned') : t('achievements.inProgress')} tone={earned ? 'success' : 'neutral'} />
      </View>
      <Text style={styles.muted}>{item.description}</Text>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.min(100, percent)}%` }, earned && styles.progressDone]} />
      </View>
      <Text style={styles.muted}>
        {item.current} {t('achievements.from')} {item.target}
        {item.earnedAt ? ` · ${new Date(item.earnedAt).toLocaleDateString()}` : ''}
      </Text>
    </Card>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    summary: { fontSize: typography.caption, color: c.textMuted },
    title: { fontSize: typography.h2, fontWeight: '700', color: c.text, flex: 1 },
    muted: { fontSize: typography.caption, color: c.textMuted },
    error: { color: c.danger, fontSize: typography.caption },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    progressTrack: {
      height: 8,
      borderRadius: 999,
      backgroundColor: c.border,
      overflow: 'hidden',
      marginTop: spacing.sm,
    },
    progressFill: { height: 8, backgroundColor: c.primary },
    progressDone: { backgroundColor: c.success },
  })
