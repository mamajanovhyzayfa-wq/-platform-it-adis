import { useState } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/api'
import { Badge, Button, Card, Loader, Screen } from '@/components/ui'
import { colors, spacing, typography } from '@/theme'

export default function KnowledgeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)

  const material = useQuery({
    queryKey: ['knowledge-material', id],
    queryFn: () => api.knowledgeMaterial(String(id)),
    enabled: Boolean(id),
  })

  const favorite = useMutation({
    mutationFn: (next: boolean) => api.setKnowledgeFavorite(String(id), next),
    onSuccess: (_, next) => {
      setNotice(next ? 'Материал добавлен в избранное' : 'Материал убран из избранного')
      void queryClient.invalidateQueries({ queryKey: ['knowledge-material', id] })
      void queryClient.invalidateQueries({ queryKey: ['knowledge-materials'] })
      void queryClient.invalidateQueries({ queryKey: ['knowledge-favorites'] })
    },
    onError: () => setNotice('Не удалось изменить избранное'),
  })

  if (material.isLoading) {
    return (
      <Screen>
        <Loader />
      </Screen>
    )
  }

  if (material.error || !material.data) {
    return (
      <Screen>
        <Text style={styles.muted}>Материал не найден или недоступен.</Text>
      </Screen>
    )
  }

  const data = material.data

  const openLink = async (url: string) => {
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      setNotice('Ссылку нельзя открыть на этом устройстве')
      return
    }
    await Linking.openURL(url)
  }

  return (
    <Screen>
      <Text style={styles.title}>{data.title}</Text>
      <View style={styles.row}>
        <Badge label={data.category.title} tone="primary" />
        <Badge label={data.type} tone="neutral" />
        {data.durationMinutes > 0 ? <Text style={styles.muted}>{data.durationMinutes} мин</Text> : null}
      </View>
      <Text style={styles.muted}>
        {data.author} · {new Date(data.createdAt ?? Date.now()).toLocaleDateString('ru-RU')} · {data.views} просмотров
      </Text>

      <Card>
        <Text style={styles.description}>{data.description}</Text>
      </Card>

      {data.content ? (
        <Card>
          <Text style={styles.content}>{data.content}</Text>
        </Card>
      ) : null}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {data.videoUrl ? (
        <Button title="Открыть видео" onPress={() => void openLink(data.videoUrl!)} />
      ) : null}
      {data.fileUrl ? (
        <Button title="Открыть файл" variant="secondary" onPress={() => void openLink(data.fileUrl!)} />
      ) : null}

      <Button
        title={data.isFavorite ? 'Убрать из избранного' : 'В избранное'}
        variant={data.isFavorite ? 'secondary' : 'primary'}
        onPress={() => favorite.mutate(!data.isFavorite)}
        disabled={favorite.isPending}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: typography.title, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  muted: { fontSize: typography.caption, color: colors.textMuted },
  description: { fontSize: typography.body, color: colors.text },
  content: { fontSize: typography.body, color: colors.text, lineHeight: 22 },
  notice: { fontSize: typography.caption, color: colors.success },
})
