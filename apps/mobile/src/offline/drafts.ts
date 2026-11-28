import AsyncStorage from '@react-native-async-storage/async-storage'

/** Черновики решений хранятся локально и переживают закрытие приложения. */
interface HomeworkDraft {
  text: string
  projectUrl: string
  files: Array<{ name: string; url: string }>
  updatedAt: string
}

const PREFIX = 'itadis.draft.homework.'

export async function saveHomeworkDraft(homeworkId: string, draft: Omit<HomeworkDraft, 'updatedAt'>) {
  const value: HomeworkDraft = { ...draft, updatedAt: new Date().toISOString() }
  await AsyncStorage.setItem(`${PREFIX}${homeworkId}`, JSON.stringify(value))
}

export async function loadHomeworkDraft(homeworkId: string): Promise<HomeworkDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${homeworkId}`)
    return raw ? (JSON.parse(raw) as HomeworkDraft) : null
  } catch {
    return null
  }
}

export async function clearHomeworkDraft(homeworkId: string) {
  await AsyncStorage.removeItem(`${PREFIX}${homeworkId}`)
}
