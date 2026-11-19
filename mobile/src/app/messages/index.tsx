import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { Badge, BottomSheet, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Title, useToast } from '@/components/ui'
import { connectSocket } from '@/services/socket'
import { useAuthStore } from '@/store/auth'
import { useI18n } from '@/i18n'
import { radius, spacing, typography, useThemedStyles, type Palette } from '@/theme'

/**
 * Список переписок: личные диалоги и чаты курсов.
 * Новый чат создаётся снизу: ученик может написать преподавателю курса или открыть чат курса,
 * преподаватель — написать своему ученику. Сами чаты курсов создаются на сервере без дублей.
 */
export default function MessagesScreen() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { t } = useI18n()
  const styles = useThemedStyles(makeStyles)
  const role = useAuthStore((state) => state.user?.role)
  const [sheetOpen, setSheetOpen] = useState(false)

  const conversations = useQuery({ queryKey: ['conversations'], queryFn: api.conversations })
  const courses = useQuery({
    queryKey: ['my-courses-for-chat'],
    queryFn: api.myCourses,
    enabled: sheetOpen && role === 'STUDENT',
  })
  const students = useQuery({
    queryKey: ['students-for-chat'],
    queryFn: api.myStudents,
    enabled: sheetOpen && (role === 'TEACHER' || role === 'ADMIN'),
  })

  useEffect(() => {
    const socket = connectSocket()
    if (!socket) return
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['conversations'] })
    socket.on('message:notification', refresh)
    return () => {
      socket.off('message:notification', refresh)
    }
  }, [queryClient])

  const openDirect = useMutation({
    mutationFn: (userId: string) => api.createDirectConversation(userId),
    onSuccess: (conversation) => {
      setSheetOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      router.push({ pathname: '/messages/[id]', params: { id: conversation.id } })
    },
    onError: (error) => toast.error(describeApiError(error)),
  })

  const openCourse = useMutation({
    mutationFn: (courseId: string) => api.createCourseConversation(courseId),
    onSuccess: (conversation) => {
      setSheetOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      router.push({ pathname: '/messages/[id]', params: { id: conversation.id } })
    },
    onError: (error) => toast.error(describeApiError(error)),
  })

  return (
    <Screen>
      <Title subtitle={t('chat.subtitle')}>{t('chat.title')}</Title>

      <Button title={`+ ${t('chat.newChat')}`} variant="secondary" onPress={() => setSheetOpen(true)} />

      {conversations.isLoading ? (
        <View style={{ gap: spacing.sm }}>
          <Skeleton height={92} borderRadius={radius.lg} />
          <Skeleton height={92} borderRadius={radius.lg} />
          <Skeleton height={92} borderRadius={radius.lg} />
        </View>
      ) : null}

      {conversations.isError ? (
        <ErrorState
          title={t('common.error')}
          message={describeApiError(conversations.error)}
          onRetry={() => void conversations.refetch()}
        />
      ) : null}

      {conversations.data && conversations.data.items.length === 0 ? (
        <EmptyState title={t('chat.empty')} hint={t('chat.emptyHint')} />
      ) : null}

      {conversations.data?.items.map((item) => (
        <Pressable key={item.id} onPress={() => router.push({ pathname: '/messages/[id]', params: { id: item.id } })}>
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title}
              </Text>
              {item.unread > 0 ? <Badge label={String(item.unread)} tone="primary" /> : null}
            </View>
            {item.type === 'COURSE' ? <Badge label={t('chat.courseChat')} tone="neutral" /> : null}
            <Text style={styles.muted} numberOfLines={2}>
              {item.lastMessage ? `${item.lastMessage.senderName}: ${item.lastMessage.body}` : t('chat.noMessages')}
            </Text>
            {item.lastMessage ? (
              <Text style={styles.time}>{new Date(item.lastMessage.createdAt).toLocaleString('ru-RU')}</Text>
            ) : null}
          </Card>
        </Pressable>
      ))}

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t('chat.newChat')}
        description={t('chat.newChatHint')}
      >
        {role === 'STUDENT' ? (
          <>
            {courses.isLoading ? <Skeleton height={64} /> : null}
            {courses.isError ? <Text style={styles.muted}>{describeApiError(courses.error)}</Text> : null}
            {(courses.data ?? []).map((item) => (
              <View key={item.course.id} style={styles.optionRow}>
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>{item.course.title}</Text>
                  <Text style={styles.muted}>{item.course.teacher.name}</Text>
                </View>
                <View style={styles.optionActions}>
                  <Button
                    title={t('chat.courseChat')}
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    loading={openCourse.isPending}
                    onPress={() => openCourse.mutate(item.course.id)}
                  />
                  <Button
                    title="Написать"
                    size="sm"
                    fullWidth={false}
                    loading={openDirect.isPending}
                    onPress={() => openDirect.mutate(item.course.teacher.id)}
                  />
                </View>
              </View>
            ))}
            {courses.data?.length === 0 ? <Text style={styles.muted}>{t('courses.empty')}</Text> : null}
          </>
        ) : (
          <>
            {students.isLoading ? <Skeleton height={64} /> : null}
            {students.isError ? <Text style={styles.muted}>{describeApiError(students.error)}</Text> : null}
            {(students.data ?? []).map((student) => (
              <View key={`${student.id}-${student.courseTitle}`} style={styles.optionRow}>
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>
                    {student.firstName} {student.lastName}
                  </Text>
                  <Text style={styles.muted}>{student.courseTitle}</Text>
                </View>
                <Button
                  title="Написать"
                  size="sm"
                  fullWidth={false}
                  loading={openDirect.isPending}
                  onPress={() => openDirect.mutate(student.id)}
                />
              </View>
            ))}
            {students.data?.length === 0 ? <Text style={styles.muted}>{t('chat.noTeachers')}</Text> : null}
          </>
        )}
      </BottomSheet>
    </Screen>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { fontSize: typography.h2, fontWeight: '700', color: c.text, flex: 1 },
    muted: { fontSize: typography.caption, color: c.textMuted, marginTop: spacing.xs },
    time: { fontSize: typography.tiny, color: c.textMuted, marginTop: spacing.xs },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    optionText: { flex: 1 },
    optionTitle: { fontSize: typography.body, fontWeight: '700', color: c.text },
    optionActions: { gap: spacing.xs, alignItems: 'flex-end' },
  })
