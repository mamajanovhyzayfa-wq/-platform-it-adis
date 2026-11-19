import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { BottomSheet, EmptyState, ErrorState, ListScreen, SearchBar, Tabs, Title } from '@/components/ui'
import { CourseCard, CourseListSkeleton } from '@/components/learning'
import { api, type CatalogCourse, type CourseLevel } from '@/api/api'
import { describeApiError } from '@/api/client'
import { useI18n } from '@/i18n'
import { spacing, typography, useThemedStyles, type Palette } from '@/theme'

type SortKey = 'new' | 'popular' | 'title'

const sortLabels: Record<SortKey, string> = {
  new: 'Сначала новые',
  popular: 'Популярные',
  title: 'По алфавиту',
}

const levelItems: Array<{ key: 'all' | CourseLevel; label: string }> = [
  { key: 'all', label: 'Все уровни' },
  { key: 'BEGINNER', label: 'Начальный' },
  { key: 'INTERMEDIATE', label: 'Средний' },
  { key: 'ADVANCED', label: 'Продвинутый' },
]

const PAGE_SIZE = 20

/**
 * Каталог курсов: поиск, категории, уровень и переключатель «мои курсы».
 * Все фильтры применяются на сервере, список на FlatList догружает страницы по 20.
 */
export default function CoursesCatalogScreen() {
  const { t } = useI18n()
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [level, setLevel] = useState<'all' | CourseLevel>('all')
  const [mine, setMine] = useState<'all' | 'mine'>('all')
  const [sort, setSort] = useState<SortKey>('new')
  const [sortOpen, setSortOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(timer)
  }, [search])

  // Отдельная константа: TypeScript не сужает union при повторных сравнениях в JSX.
  const isMineView = mine === 'mine'

  const categories = useQuery({ queryKey: ['course-categories'], queryFn: api.courseCategories })
  const catalog = useInfiniteQuery({
    queryKey: ['catalog', debouncedSearch, category, level, mine, sort],
    queryFn: ({ pageParam }) =>
      api.catalogCourses({
        search: debouncedSearch || undefined,
        category: category ?? undefined,
        level: level === 'all' ? undefined : level,
        mine: isMineView,
        sort,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0)
      return lastPage.hasMore ? loaded : undefined
    },
  })

  const categoryItems = useMemo(
    () => [
      { key: 'all', label: 'Все категории' },
      ...(categories.data ?? []).map((item) => ({
        key: item.slug,
        label: `${item.icon ?? ''} ${item.title}`.trim(),
        badge: item.coursesCount,
      })),
    ],
    [categories.data],
  )

  const hasFilters = Boolean(debouncedSearch) || category !== null || level !== 'all' || isMineView
  const items = catalog.data?.pages.flatMap((page) => page.items) ?? []
  const total = catalog.data?.pages[0]?.total ?? 0
  const showSkeleton = catalog.isLoading

  return (
    <>
      <ListScreen<CatalogCourse>
        data={items}
        keyExtractor={(item) => item.id}
        refreshing={catalog.isRefetching}
        onRefresh={() => void catalog.refetch()}
        onEndReached={() => {
          if (catalog.hasNextPage && !catalog.isFetchingNextPage) void catalog.fetchNextPage()
        }}
        loadingMore={catalog.isFetchingNextPage}
        header={
          <>
            <Title subtitle="Выбирайте курс, фильтруйте по направлению и продолжайте с того места, где остановились.">
              {t('nav.courses')}
            </Title>

            <SearchBar
              value={search}
              onChangeText={setSearch}
              placeholder="Поиск по названию или описанию"
              accessibilityLabel="Поиск курсов"
            />

            <Tabs<'all' | 'mine'>
              items={[
                { key: 'all', label: 'Все курсы' },
                { key: 'mine', label: 'Мои курсы' },
              ]}
              value={mine}
              onChange={setMine}
            />

            <Tabs<string>
              items={categoryItems}
              value={category ?? 'all'}
              onChange={(key) => setCategory(key === 'all' ? null : key)}
              scrollable
            />

            <Tabs<'all' | CourseLevel> items={levelItems} value={level} onChange={setLevel} scrollable />

            <View style={styles.filterRow}>
              <Text style={styles.count}>
                {catalog.data ? `${total} ${total === 1 ? 'курс' : 'курсов'}` : 'Поиск…'}
                {hasFilters ? ' по фильтрам' : ''}
              </Text>
              <Text style={styles.sort} onPress={() => setSortOpen(true)} accessibilityRole="button">
                {sortLabels[sort]} ▾
              </Text>
            </View>
          </>
        }
        empty={
          showSkeleton ? (
            <CourseListSkeleton count={4} />
          ) : catalog.isError ? (
            <ErrorState
              title="Каталог недоступен"
              message={describeApiError(catalog.error)}
              onRetry={() => void catalog.refetch()}
            />
          ) : (
            <EmptyState
              title={isMineView ? 'Вы пока не записаны на курсы' : 'Курсы не найдены'}
              hint={
                hasFilters
                  ? 'Попробуйте изменить запрос или сбросить фильтры.'
                  : isMineView
                    ? 'Откройте «Все курсы» и запишитесь на подходящий.'
                    : 'Преподаватели ещё не опубликовали курсы.'
              }
            />
          )
        }
        renderItem={({ item }) => (
          <CourseCard
            title={item.title}
            description={item.description}
            teacher={item.teacher.name}
            level={item.level}
            category={item.category}
            lessonsCount={item.lessonsCount}
            durationMinutes={item.durationMinutes}
            studentsCount={item.studentsCount}
            progress={item.enrolled ? item.progress : undefined}
            onPress={() => router.push({ pathname: '/course/[id]', params: { id: item.id } })}
          />
        )}
      />

      <BottomSheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Сортировка">
        {Object.entries(sortLabels).map(([key, label]) => (
          <Text
            key={key}
            onPress={() => {
              setSort(key as SortKey)
              setSortOpen(false)
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: sort === key }}
            style={[styles.sortOption, sort === key && styles.sortOptionActive]}
          >
            {label}
            {sort === key ? ' ✓' : ''}
          </Text>
        ))}
      </BottomSheet>
    </>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    count: { fontSize: typography.caption, color: c.textMuted },
    sort: { fontSize: typography.caption, fontWeight: '700', color: c.primary, paddingVertical: spacing.xs },
    sortOption: {
      fontSize: typography.body,
      color: c.text,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    sortOptionActive: { color: c.primary, fontWeight: '700' },
  })
