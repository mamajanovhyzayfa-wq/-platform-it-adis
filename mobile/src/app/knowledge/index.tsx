import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type KnowledgeItem } from '@/api/api'
import { Badge, Card, EmptyState, Loader, Screen, Title } from '@/components/ui'
import { colors, radius, spacing, typography } from '@/theme'

const typeLabels: Record<KnowledgeItem['type'], string> = {
  VIDEO: 'Видео',
  DOCUMENT: 'Документ',
  PRESENTATION: 'Презентация',
  IMAGE: 'Изображение',
  LINK: 'Ссылка',
}

export default function KnowledgeScreen() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<'new' | 'popular'>('new')

  const categories = useQuery({ queryKey: ['knowledge-categories'], queryFn: api.knowledgeCategories })
  const materials = useQuery({
    queryKey: ['knowledge-materials', search, category, sort],
    queryFn: () => api.knowledgeMaterials({ search: search.trim() || undefined, category: category ?? undefined, sort }),
  })
  const recommendations = useQuery({ queryKey: ['knowledge-recommendations'], queryFn: api.knowledgeRecommendations })

  const favorite = useMutation({
    mutationFn: (item: KnowledgeItem) => api.setKnowledgeFavorite(item.id, !item.isFavorite),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['knowledge-materials'] })
      void queryClient.invalidateQueries({ queryKey: ['knowledge-favorites'] })
    },
  })

  return (
    <Screen>
      <Title subtitle="Библиотека материалов по направлениям">База знаний</Title>

      <TextInput
        style={styles.search}
        placeholder="Поиск по названию и описанию"
        placeholderTextColor={colors.textMuted}
        value={search}
        onChangeText={setSearch}
        returnKeyType="search"
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Pressable onPress={() => setCategory(null)} style={[styles.chip, !category && styles.chipActive]}>
          <Text style={[styles.chipText, !category && styles.chipTextActive]}>Все</Text>
        </Pressable>
        {categories.data?.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => setCategory(item.slug === category ? null : item.slug)}
            style={[styles.chip, category === item.slug && styles.chipActive]}
          >
            <Text style={[styles.chipText, category === item.slug && styles.chipTextActive]}>
              {item.title} · {item.materials}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.sortRow}>
        <Pressable onPress={() => setSort('new')}>
          <Text style={[styles.sort, sort === 'new' && styles.sortActive]}>Новые</Text>
        </Pressable>
        <Pressable onPress={() => setSort('popular')}>
          <Text style={[styles.sort, sort === 'popular' && styles.sortActive]}>Популярные</Text>
        </Pressable>
      </View>

      {materials.isLoading ? <Loader /> : null}
      {materials.error ? <Text style={styles.error}>Не удалось загрузить материалы</Text> : null}
      {materials.data && materials.data.items.length === 0 ? (
        <EmptyState title="Материалов не найдено" hint="Измените запрос или выберите другую категорию." />
      ) : null}

      {materials.data?.items.map((item) => (
        <Card key={item.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Pressable onPress={() => favorite.mutate(item)} hitSlop={8}>
              <Text style={[styles.favorite, item.isFavorite && styles.favoriteActive]}>
                {item.isFavorite ? '★' : '☆'}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.muted} numberOfLines={2}>
            {item.description}
          </Text>
          <View style={styles.row}>
            <Badge label={typeLabels[item.type]} tone="primary" />
            <Badge label={item.category.title} tone="neutral" />
            {item.durationMinutes > 0 ? <Text style={styles.muted}>{item.durationMinutes} мин</Text> : null}
            {typeof item.views === 'number' ? <Text style={styles.muted}>· {item.views} просм.</Text> : null}
          </View>
          <Pressable
            style={styles.open}
            onPress={() => router.push({ pathname: '/knowledge/[id]', params: { id: item.id } })}
          >
            <Text style={styles.openText}>Открыть материал →</Text>
          </Pressable>
        </Card>
      ))}

      {recommendations.data && recommendations.data.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Рекомендуем</Text>
          {recommendations.data.map((item) => (
            <Card key={`rec-${item.id}`}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Badge label={typeLabels[item.type]} tone="neutral" />
              </View>
              <Text style={styles.muted} numberOfLines={2}>
                {item.description}
              </Text>
              <Pressable
                style={styles.open}
                onPress={() => router.push({ pathname: '/knowledge/[id]', params: { id: item.id } })}
              >
                <Text style={styles.openText}>Открыть материал →</Text>
              </Pressable>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.body,
    color: colors.text,
  },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: typography.caption, color: colors.textMuted },
  chipTextActive: { color: colors.white, fontWeight: '600' },
  sortRow: { flexDirection: 'row', gap: spacing.lg },
  sort: { fontSize: typography.caption, color: colors.textMuted },
  sortActive: { color: colors.primary, fontWeight: '700' },
  cardTitle: { fontSize: typography.h2, fontWeight: '700', color: colors.text, flex: 1 },
  muted: { fontSize: typography.caption, color: colors.textMuted },
  error: { fontSize: typography.caption, color: colors.danger },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.xs },
  favorite: { fontSize: 20, color: colors.textMuted },
  favoriteActive: { color: colors.warning },
  open: { marginTop: spacing.sm },
  openText: { color: colors.primary, fontWeight: '600', fontSize: typography.caption },
  sectionTitle: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginTop: spacing.md },
})
