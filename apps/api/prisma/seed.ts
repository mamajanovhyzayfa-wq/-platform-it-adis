import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { bootstrapRbac } from './bootstrap-rbac.js'

const prisma = new PrismaClient()

const DEMO_PASSWORD = 'ITadis2026'

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)

  // Роли, права и матрица доступа — общий bootstrap (см. prisma/bootstrap-rbac.ts).
  await bootstrapRbac(prisma)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@itadis.kg' },
    update: {},
    create: {
      email: 'admin@itadis.kg',
      passwordHash,
      firstName: 'Айбек',
      lastName: 'Администратов',
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
      coinBalance: { create: { balance: 0 } },
    },
  })

  const manager = await prisma.user.upsert({
    where: { email: 'manager@itadis.kg' },
    update: {},
    create: {
      email: 'manager@itadis.kg',
      passwordHash,
      firstName: 'Гүлнара',
      lastName: 'Осмонова',
      role: 'MANAGER',
      emailVerifiedAt: new Date(),
      coinBalance: { create: { balance: 0 } },
    },
  })

  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@itadis.kg' },
    update: {},
    create: {
      email: 'teacher@itadis.kg',
      phone: '+996700000001',
      passwordHash,
      firstName: 'Нурсултан',
      lastName: 'Асанов',
      role: 'TEACHER',
      emailVerifiedAt: new Date(),
      teacherProfile: { create: { specialization: 'Мобильная разработка', experienceYears: 5 } },
      coinBalance: { create: { balance: 0 } },
    },
  })

  await prisma.teacher.upsert({
    where: { userId: teacher.id },
    update: {},
    create: { userId: teacher.id, specialization: 'Мобильная разработка', experienceYears: 5 },
  })

  const student = await prisma.user.upsert({
    where: { email: 'student@itadis.kg' },
    update: {},
    create: {
      email: 'student@itadis.kg',
      phone: '+996700000002',
      passwordHash,
      firstName: 'Адис',
      lastName: 'Исаков',
      role: 'STUDENT',
      emailVerifiedAt: new Date(),
      profile: { create: { timezone: 'Asia/Bishkek', bio: 'Учусь на фронтенд-разработчика' } },
      studentProfile: { create: { gradeLevel: 11, schoolName: 'Лицей ITadis' } },
      coinBalance: { create: { balance: 120 } },
    },
  })

  await prisma.student.upsert({
    where: { userId: student.id },
    update: {},
    create: { userId: student.id, gradeLevel: 11, schoolName: 'Лицей ITadis' },
  })

  // Родитель ученика: демонстрация родительского доступа и связи parent-student.
  const parent = await prisma.user.upsert({
    where: { email: 'parent@itadis.kg' },
    update: {},
    create: {
      email: 'parent@itadis.kg',
      phone: '+996700000003',
      passwordHash,
      firstName: 'Гульнара',
      lastName: 'Исакова',
      role: 'PARENT',
      emailVerifiedAt: new Date(),
      parentProfile: { create: { workplace: 'ОсОО «Альфа»' } },
      coinBalance: { create: { balance: 0 } },
    },
  })

  await prisma.parent.upsert({
    where: { userId: parent.id },
    update: {},
    create: { userId: parent.id, workplace: 'ОсОО «Альфа»' },
  })

  const parentProfile = await prisma.parent.findUniqueOrThrow({ where: { userId: parent.id } })
  const studentProfile = await prisma.student.findUniqueOrThrow({ where: { userId: student.id } })
  await prisma.parentStudentLink.upsert({
    where: { parentId_studentId: { parentId: parentProfile.id, studentId: studentProfile.id } },
    update: {},
    create: {
      parentId: parentProfile.id,
      studentId: studentProfile.id,
      relation: 'MOTHER',
      isPrimary: true,
      verifiedAt: new Date(),
    },
  })

  // Категории каталога: по ним ученик фильтрует курсы на главном экране обучения.
  const courseCategories = [
    { slug: 'javascript', title: 'JavaScript', icon: '🟨', position: 1 },
    { slug: 'python', title: 'Python', icon: '🐍', position: 2 },
    { slug: 'react', title: 'React', icon: '⚛️', position: 3 },
    { slug: 'react-native', title: 'React Native', icon: '📱', position: 4 },
    { slug: 'backend', title: 'Backend', icon: '🛠️', position: 5 },
    { slug: 'design', title: 'Дизайн', icon: '🎨', position: 6 },
  ]

  for (const category of courseCategories) {
    await prisma.courseCategory.upsert({
      where: { slug: category.slug },
      update: { title: category.title, icon: category.icon, position: category.position },
      create: category,
    })
  }

  const sampleVideo = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4'

  type SeedLesson = {
    title: string
    description: string
    content: string
    durationMinutes: number
    videoUrl?: string
    materials?: Array<{ type: 'LINK' | 'DOCUMENT' | 'PRESENTATION'; title: string; url: string }>
  }

  const courseCatalog: Array<{
    slug: string
    title: string
    description: string
    category: string
    level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
    modules: Array<{ title: string; description: string; lessons: SeedLesson[] }>
  }> = [
    {
      slug: 'react-native-start',
      title: 'React Native с нуля',
      description: 'Практический курс по созданию мобильных приложений на React Native и Expo.',
      category: 'react-native',
      level: 'BEGINNER',
      modules: [
        {
          title: 'Основы React Native',
          description: 'Компоненты, стили, навигация',
          lessons: [
            {
              title: 'Введение в React Native',
              description: 'Как работает JS-поток и мост к нативным компонентам.',
              content:
                'React Native рендерит нативные компоненты через собственный рендерер. JavaScript-код выполняется в отдельном потоке, а не в WebView, поэтому интерфейс остаётся отзывчивым даже при тяжелых вычислениях.\n\nКлючевая идея — UI описывается декларативно теми же компонентами, что и в React: View, Text, Image, Pressable. Отличия начинаются в стилях: вместо CSS используется StyleSheet с ограниченным набором свойств.',
              durationMinutes: 25,
              videoUrl: sampleVideo,
              materials: [
                { type: 'LINK', title: 'Документация React Native', url: 'https://reactnative.dev/docs/getting-started' },
                { type: 'DOCUMENT', title: 'Шпаргалка по компонентам', url: 'https://reactnative.dev/docs/components-and-apis' },
              ],
            },
            {
              title: 'Expo Router за 30 минут',
              description: 'Файловая маршрутизация и группы маршрутов.',
              content:
                'Каждый файл в app/ — это маршрут. Группы в скобках не попадают в URL и удобны для ролей: (auth), (student), (teacher). Параметры читаются через useLocalSearchParams, а переходы выполняются router.push с объектом pathname/params, чтобы типы маршрутов проверялись на этапе компиляции.',
              durationMinutes: 30,
              videoUrl: sampleVideo,
            },
            {
              title: 'Стили и адаптивность',
              description: 'Flexbox, SafeArea и поддержка тёмной темы.',
              content:
                'В React Native нет каскада: стили — это объекты. Flexbox работает по умолчанию для любого View, направление — column. SafeAreaView учитывает вырезы экрана, а useColorScheme позволяет переключать палитру без перезапуска приложения.',
              durationMinutes: 35,
            },
          ],
        },
        {
          title: 'Данные и состояние',
          description: 'Zustand, TanStack Query и работа с API',
          lessons: [
            {
              title: 'TanStack Query: кеш и состояния',
              description: 'Загрузка, ошибка, повторная проверка данных.',
              content:
                'useQuery возвращает isLoading, error, data и refetch. Запросы кешируются по ключу, поэтому экран показывает данные сразу при повторном открытии. Для мутаций используется useMutation с invalidateQueries — так список курсов обновится после завершения урока.',
              durationMinutes: 28,
              videoUrl: sampleVideo,
            },
            {
              title: 'Глобальное состояние без лишних ререндеров',
              description: 'Селекторы Zustand и хранение сессии.',
              content:
                'Zustand хранит состояние в обычном объекте. Компонент подписывается на конкретный срез через селектор и не перерисовывается при изменении остальных полей. Токены доступа живут в SecureStore, а не в AsyncStorage.',
              durationMinutes: 22,
            },
          ],
        },
      ],
    },
    {
      slug: 'javascript-basics',
      title: 'JavaScript: основы',
      description: 'Синтаксис, функции, массивы и асинхронность — база для любого направления в IT.',
      category: 'javascript',
      level: 'BEGINNER',
      modules: [
        {
          title: 'Синтаксис и типы',
          description: 'Переменные, объекты и приведение типов',
          lessons: [
            {
              title: 'Переменные и область видимости',
              description: 'let, const и поднятие переменных.',
              content:
                'const запрещает переприсваивание ссылки, но не делает объект неизменяемым. let создаёт блочную переменную. var поднимается в начало функции — поэтому в современном коде его не используют.',
              durationMinutes: 18,
              videoUrl: sampleVideo,
            },
            {
              title: 'Массивы: map, filter, reduce',
              description: 'Функциональные методы без циклов.',
              content:
                'map преобразует каждый элемент, filter оставляет подходящие, reduce сворачивает массив в одно значение. Эти методы не меняют исходный массив и читаются лучше вложенных for.',
              durationMinutes: 24,
            },
          ],
        },
        {
          title: 'Асинхронность',
          description: 'Промисы и async/await',
          lessons: [
            {
              title: 'Промисы и обработка ошибок',
              description: 'Цепочки, Promise.all и try/catch.',
              content:
                'Промис — объект будущего результата. Promise.all запускает запросы параллельно и падает целиком, Promise.allSettled ждёт все результаты. В async-функции ошибку ловит try/catch вокруг await.',
              durationMinutes: 26,
            },
          ],
        },
      ],
    },
    {
      slug: 'python-start',
      title: 'Python для начинающих',
      description: 'Первый язык программирования: типы, циклы, функции и работа с данными.',
      category: 'python',
      level: 'BEGINNER',
      modules: [
        {
          title: 'Базовый синтаксис',
          description: 'Отступы, типы и ввод данных',
          lessons: [
            {
              title: 'Переменные и типы данных',
              description: 'int, float, str, bool и приведение типов.',
              content:
                'Python — язык с динамической типизацией. Тип определяется значением, но аннотации помогают читать код и проверяться линтером. int и float поддерживают арифметику, str — срезы и методы.',
              durationMinutes: 20,
              videoUrl: sampleVideo,
            },
            {
              title: 'Списки и словари',
              description: 'Изменяемые коллекции и их методы.',
              content:
                'Список хранит упорядоченные элементы, словарь — пары ключ-значение с быстрым доступом. Срезы list[start:stop:step] создают новый список и не меняют исходный.',
              durationMinutes: 22,
            },
          ],
        },
      ],
    },
    {
      slug: 'react-professional',
      title: 'React: профессиональный уровень',
      description: 'Хуки, архитектура компонентов, производительность и тестирование интерфейсов.',
      category: 'react',
      level: 'INTERMEDIATE',
      modules: [
        {
          title: 'Хуки и состояние',
          description: 'useState, useEffect, useReducer',
          lessons: [
            {
              title: 'Правила хуков',
              description: 'Порядок вызова и пользовательские хуки.',
              content:
                'Хуки вызываются только на верхнем уровне компонента и не внутри условий. Пользовательский хук — функция с префиксом use, которая переиспользует логику, но не состояние.',
              durationMinutes: 21,
              videoUrl: sampleVideo,
            },
            {
              title: 'Мемоизация без преждевременной оптимизации',
              description: 'useMemo, useCallback и React.memo.',
              content:
                'Мемоизация помогает, когда вычисление дорогое или компонент часто ререндерится. Сначала измеряйте, затем оптимизируйте: лишние зависимости useCallback могут сделать код хуже.',
              durationMinutes: 27,
            },
          ],
        },
        {
          title: 'Архитектура',
          description: 'Слои, фичи и переиспользуемые компоненты',
          lessons: [
            {
              title: 'Feature-sliced структура',
              description: 'Где хранить API, состояние и UI.',
              content:
                'Фича объединяет запросы, состояние и компоненты одной предметной области. Общие UI-компоненты не знают о бизнес-логике, а экран собирает фичу и навигацию.',
              durationMinutes: 25,
            },
          ],
        },
      ],
    },
    {
      slug: 'backend-node',
      title: 'Backend на Node.js',
      description: 'HTTP, PostgreSQL, Prisma, аутентификация и безопасность API.',
      category: 'backend',
      level: 'INTERMEDIATE',
      modules: [
        {
          title: 'API и база данных',
          description: 'REST, валидация и транзакции',
          lessons: [
            {
              title: 'Проектирование REST API',
              description: 'Ресурсы, коды ответов и идемпотентность.',
              content:
                'REST описывает ресурсы, а не действия. Коды ответов должны отражать результат: 201 при создании, 204 при удалении, 409 при конфликте. Повторный запрос с тем же ключом идемпотентности не должен создавать дубль.',
              durationMinutes: 30,
              videoUrl: sampleVideo,
            },
            {
              title: 'Транзакции в Prisma',
              description: 'Атомарные операции для баланса и остатков.',
              content:
                'prisma.$transaction позволяет выполнить несколько операций атомарно. Внутри интерактивной транзакции можно прочитать баланс, проверить остаток, списать монеты и создать заявку: при исключении база откатится.',
              durationMinutes: 24,
            },
          ],
        },
      ],
    },
    {
      slug: 'ui-design-basics',
      title: 'UI/UX дизайн интерфейсов',
      description: 'Сетки, типографика, цвет и прототипирование мобильных приложений.',
      category: 'design',
      level: 'BEGINNER',
      modules: [
        {
          title: 'Визуальная система',
          description: 'Отступы, шрифты и контраст',
          lessons: [
            {
              title: 'Сетка и ритм',
              description: 'Единая система отступов.',
              content:
                'Используйте шаг сетки 4 или 8 пикселей. Отступы должны повторяться: 8, 12, 16, 24. Ритм помогает глазу сканировать экран и делает интерфейс спокойнее.',
              durationMinutes: 18,
              videoUrl: sampleVideo,
            },
            {
              title: 'Доступность и контраст',
              description: 'Минимальные размеры и цветовые пары.',
              content:
                'Основной текст должен иметь контраст не ниже 4.5:1. Интерактивные элементы — не меньше 44×44 pt. Не передавайте смысл только цветом: добавляйте иконку или текст.',
              durationMinutes: 20,
            },
          ],
        },
      ],
    },
  ]

  let course: { id: string } | null = null

  for (const entry of courseCatalog) {
    const category = await prisma.courseCategory.findUnique({ where: { slug: entry.category } })
    const seededCourse = await prisma.course.upsert({
      where: { slug: entry.slug },
      update: { categoryId: category?.id, level: entry.level, description: entry.description },
      create: {
        title: entry.title,
        slug: entry.slug,
        description: entry.description,
        level: entry.level,
        status: 'ACTIVE',
        teacherId: teacher.id,
        categoryId: category?.id,
        startDate: new Date(),
        modules: {
          create: entry.modules.map((module, moduleIndex) => ({
            title: module.title,
            description: module.description,
            position: moduleIndex + 1,
            lessons: {
              create: module.lessons.map((lesson, lessonIndex) => ({
                title: lesson.title,
                description: lesson.description,
                content: lesson.content,
                videoUrl: lesson.videoUrl,
                durationMinutes: lesson.durationMinutes,
                position: lessonIndex + 1,
                publishedAt: new Date(),
                materials: lesson.materials ? { create: lesson.materials } : undefined,
              })),
            },
          })),
        },
      },
    })

    course ??= seededCourse

    // Чистим модуль из первой версии seed, чтобы демо-курс не содержал дублей уроков.
    await prisma.module.deleteMany({ where: { courseId: seededCourse.id, title: 'Модуль 1. Основы' } })

    // Курс мог быть создан раньше — досоздаём недостающие модули и уроки по названию.
    for (const [moduleIndex, module] of entry.modules.entries()) {
      const existingModule =
        (await prisma.module.findFirst({ where: { courseId: seededCourse.id, title: module.title } })) ??
        (await prisma.module.create({
          data: {
            courseId: seededCourse.id,
            title: module.title,
            description: module.description,
            position: moduleIndex + 1,
          },
        }))

      for (const [lessonIndex, lesson] of module.lessons.entries()) {
        const existingLesson = await prisma.lesson.findFirst({
          where: { moduleId: existingModule.id, title: lesson.title },
          select: { id: true, videoUrl: true, content: true },
        })

        if (!existingLesson) {
          await prisma.lesson.create({
            data: {
              moduleId: existingModule.id,
              title: lesson.title,
              description: lesson.description,
              content: lesson.content,
              videoUrl: lesson.videoUrl,
              durationMinutes: lesson.durationMinutes,
              position: lessonIndex + 1,
              publishedAt: new Date(),
              materials: lesson.materials ? { create: lesson.materials } : undefined,
            },
          })
          continue
        }

        // Старые демо-уроки получили только заголовок — дополняем контентом и видео.
        if (!existingLesson.videoUrl || !existingLesson.content) {
          await prisma.lesson.update({
            where: { id: existingLesson.id },
            data: {
              videoUrl: existingLesson.videoUrl ?? lesson.videoUrl,
              content: existingLesson.content ?? lesson.content,
            },
          })
        }
      }
    }
  }

  if (!course) throw new Error('Не удалось создать курсы')

  const enrolledCourses = await prisma.course.findMany({
    where: { slug: { in: ['react-native-start', 'javascript-basics', 'backend-node'] } },
    select: { id: true },
  })

  for (const [index, enrolledCourse] of enrolledCourses.entries()) {
    await prisma.courseEnrollment.upsert({
      where: { courseId_studentId: { courseId: enrolledCourse.id, studentId: student.id } },
      update: {},
      create: { courseId: enrolledCourse.id, studentId: student.id, status: 'ACTIVE', progress: index === 0 ? 35 : 0 },
    })
  }

  // Первый урок курса пройден — на главном экране есть что продолжить.
  const firstLesson = await prisma.lesson.findFirst({
    where: { module: { course: { slug: 'react-native-start' } } },
    orderBy: [{ module: { position: 'asc' } }, { position: 'asc' }],
    select: { id: true },
  })
  if (firstLesson) {
    await prisma.lessonProgress.upsert({
      where: { lessonId_studentId: { lessonId: firstLesson.id, studentId: student.id } },
      update: {},
      create: { lessonId: firstLesson.id, studentId: student.id, status: 'COMPLETED', completedAt: new Date() },
    })
  }

  const homeworkCount = await prisma.homework.count({ where: { courseId: course.id } })
  if (homeworkCount === 0) {
    await prisma.homework.create({
      data: {
        courseId: course.id,
        teacherId: teacher.id,
        title: 'Свёрстать экран профиля',
        description: 'Соберите экран профиля с аватаром, статистикой и кнопкой выхода. Пришлите ссылку на репозиторий.',
        dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        maxScore: 10,
      },
    })
  }

  const scheduleCount = await prisma.schedule.count({ where: { courseId: course.id } })
  if (scheduleCount === 0) {
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    startsAt.setMinutes(0, 0, 0)
    await prisma.schedule.create({
      data: {
        courseId: course.id,
        teacherId: teacher.id,
        title: 'Разбор домашнего задания',
        description: 'Онлайн-встреча: вопросы по вёрстке и навигации.',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        timezone: 'Asia/Bishkek',
        room: { create: { roomName: `room-${Date.now()}`, createdById: teacher.id } },
      },
    })
  }

  const extraAchievements = [
    {
      code: 'FIRST_HOMEWORK',
      title: 'Первое домашнее задание',
      description: 'Проверено первое домашнее задание',
      rarity: 'COMMON',
      category: 'Учёба',
      collection: 'Первые шаги',
      rewardCoins: 20,
      condition: { type: 'homework_reviewed', value: 1, rewardCoins: 20 },
    },
    {
      code: 'TEST_ACE',
      title: 'Пять тестов',
      description: 'Пройдено пять тестов',
      rarity: 'RARE',
      category: 'Учёба',
      collection: 'Проверка знаний',
      rewardCoins: 50,
      condition: { type: 'tests_completed', value: 5, rewardCoins: 50 },
    },
    {
      code: 'COIN_COLLECTOR',
      title: 'Копилка IT Coins',
      description: 'Заработано 100 IT Coins',
      rarity: 'COMMON',
      category: 'Активность',
      collection: 'Экономика',
      rewardCoins: 25,
      condition: { type: 'coins_earned', value: 100, rewardCoins: 25 },
    },
    {
      code: 'ATTENDANCE_5',
      title: 'Активный ученик',
      description: 'Посещено пять занятий',
      rarity: 'RARE',
      category: 'Посещаемость',
      collection: 'Активность',
      rewardCoins: 30,
      condition: { type: 'attendance', value: 5, rewardCoins: 30 },
    },
    {
      code: 'PERFECT_TEST',
      title: 'Безупречный тест',
      description: 'Тест сдан на 90% и выше',
      rarity: 'EPIC',
      category: 'Учёба',
      collection: 'Проверка знаний',
      rewardCoins: 60,
      condition: { type: 'perfect_tests', value: 1, rewardCoins: 60 },
    },
    {
      code: 'COURSE_FINISHER',
      title: 'Завершённый курс',
      description: 'Пройден первый курс полностью',
      rarity: 'EPIC',
      category: 'Прогресс',
      collection: 'Учебный путь',
      rewardCoins: 100,
      condition: { type: 'courses_completed', value: 1, rewardCoins: 100 },
    },
    {
      code: 'STREAK_7',
      title: 'Семь дней подряд',
      description: 'Семь учебных дней без пропусков',
      rarity: 'LEGENDARY',
      category: 'Активность',
      collection: 'Серии',
      rewardCoins: 150,
      condition: { type: 'active_days', value: 7, rewardCoins: 150 },
    },
  ]

  for (const item of extraAchievements) {
    const { condition, ...meta } = item
    await prisma.achievement.upsert({ where: { code: item.code }, update: meta, create: { ...meta, condition } })
  }

  const achievement = await prisma.achievement.upsert({
    where: { code: 'FIRST_LESSON' },
    update: { rarity: 'COMMON', category: 'Учёба', collection: 'Первые шаги', rewardCoins: 10 },
    create: {
      code: 'FIRST_LESSON',
      title: 'Первый урок',
      description: 'Завершён первый урок курса',
      rarity: 'COMMON',
      category: 'Учёба',
      collection: 'Первые шаги',
      rewardCoins: 10,
      condition: { type: 'lessons_completed', value: 1, rewardCoins: 10 },
    },
  })

  await prisma.userAchievement.upsert({
    where: { userId_achievementId: { userId: student.id, achievementId: achievement.id } },
    update: {},
    create: { userId: student.id, achievementId: achievement.id },
  })

  const productCount = await prisma.shopProduct.count()
  if (productCount === 0) {
    await prisma.shopProduct.createMany({
      data: [
        { title: 'Фирменная футболка IT Adis', description: 'Хлопок, размер M', category: 'PHYSICAL', priceCoins: 500, stock: 10, unlimitedStock: false, kind: 'PHYSICAL', fulfillment: 'MANUAL' },
        { title: 'Сертификат на консультацию', description: 'Час с преподавателем', category: 'PRIVILEGE', priceCoins: 300, unlimitedStock: true, kind: 'DIGITAL', fulfillment: 'AUTOMATIC', deliveryUrl: 'https://itadis.kg/profile?reward=consultation' },
        { title: 'Цифровая награда «Активист»', description: 'Бейдж в профиле', category: 'DIGITAL', priceCoins: 100, unlimitedStock: true, kind: 'DIGITAL', fulfillment: 'AUTOMATIC', deliveryUrl: 'https://itadis.kg/profile?badge=activist' },
      ],
    })
  }

  const testCount = await prisma.test.count({ where: { courseId: course.id } })
  if (testCount === 0) {
    await prisma.test.create({
      data: {
        courseId: course.id,
        title: 'Основы React Native',
        description: 'Проверка базовых знаний: компоненты, состояние и хуки.',
        timeLimitMinutes: 20,
        passingScore: 60,
        attemptsAllowed: 3,
        shuffleQuestions: false,
        shuffleOptions: false,
        isPublished: true,
        questions: {
          create: [
            {
              type: 'SINGLE',
              prompt: 'Какой компонент используется для отображения текста?',
              points: 1,
              position: 1,
              options: {
                create: [
                  { text: 'Text', isCorrect: true, position: 1 },
                  { text: 'View', isCorrect: false, position: 2 },
                  { text: 'Image', isCorrect: false, position: 3 },
                ],
              },
            },
            {
              type: 'MULTIPLE',
              prompt: 'Какие хуки существуют в React?',
              points: 2,
              position: 2,
              options: {
                create: [
                  { text: 'useState', isCorrect: true, position: 1 },
                  { text: 'useEffect', isCorrect: true, position: 2 },
                  { text: 'useDatabase', isCorrect: false, position: 3 },
                ],
              },
            },
            {
              type: 'TEXT',
              prompt: 'Назовите хук для побочных эффектов',
              points: 1,
              position: 3,
              options: { create: [{ text: 'useEffect', isCorrect: true, position: 1 }] },
            },
            {
              type: 'NUMBER',
              prompt: 'Сколько обязательных аргументов у useState?',
              points: 1,
              position: 4,
              correctNumber: 1,
            },
            {
              type: 'BOOLEAN',
              prompt: 'Expo Router использует файловую маршрутизацию',
              points: 1,
              position: 5,
              correctBoolean: true,
            },
            {
              type: 'MATCHING',
              prompt: 'Сопоставьте инструмент и назначение',
              points: 2,
              position: 6,
              matchPairs: [
                { left: 'React', right: 'UI-библиотека' },
                { left: 'Prisma', right: 'ORM' },
              ],
            },
          ],
        },
      },
    })
  }

  if ((await prisma.notification.count({ where: { userId: student.id } })) === 0) {
    await prisma.notification.createMany({
      data: [
        {
          userId: student.id,
          type: 'HOMEWORK_ASSIGNED',
          title: 'Новое домашнее задание',
          body: 'Свёрстать экран профиля — срок сдачи через 3 дня',
        },
        {
          userId: student.id,
          type: 'ACHIEVEMENT_UNLOCKED',
          title: 'Достижение получено',
          body: 'Первый урок пройден',
        },
      ],
    })
  }

  const knowledgeCategories = [
    { slug: 'programming', title: 'Программирование', position: 1 },
    { slug: 'frontend', title: 'Frontend', position: 2 },
    { slug: 'backend', title: 'Backend', position: 3 },
    { slug: 'javascript', title: 'JavaScript', position: 4 },
    { slug: 'react', title: 'React', position: 5 },
    { slug: 'react-native', title: 'React Native', position: 6 },
    { slug: 'python', title: 'Python', position: 7 },
    { slug: 'design', title: 'Дизайн', position: 8 },
    { slug: 'gamedev', title: 'Разработка игр', position: 9 },
    { slug: 'ai', title: 'Искусственный интеллект', position: 10 },
    { slug: 'soft-skills', title: 'Soft Skills', position: 11 },
    { slug: 'career', title: 'Карьера в IT', position: 12 },
  ]

  for (const item of knowledgeCategories) {
    await prisma.knowledgeCategory.upsert({ where: { slug: item.slug }, update: { title: item.title }, create: item })
  }

  if ((await prisma.knowledgeMaterial.count()) === 0) {
    const reactNative = await prisma.knowledgeCategory.findUnique({ where: { slug: 'react-native' } })
    const javascript = await prisma.knowledgeCategory.findUnique({ where: { slug: 'javascript' } })
    const backendCategory = await prisma.knowledgeCategory.findUnique({ where: { slug: 'backend' } })

    if (reactNative && javascript && backendCategory) {
      await prisma.knowledgeMaterial.createMany({
        data: [
          {
            categoryId: reactNative.id,
            authorId: teacher.id,
            title: 'Навигация в Expo Router',
            description: 'Файловая маршрутизация, вложенные группы и передача параметров.',
            type: 'DOCUMENT',
            content:
              'Каждый файл в app/ — маршрут. Группы в скобках не попадают в URL и удобны для ролей. Параметры читаются через useLocalSearchParams, а переходы выполняются router.push с объектом pathname/params, чтобы типы маршрутов проверялись на этапе компиляции.',
            durationMinutes: 12,
          },
          {
            categoryId: javascript.id,
            authorId: teacher.id,
            title: 'Промисы и async/await без ошибок',
            description: 'Как не потерять ошибку и правильно обрабатывать параллельные запросы.',
            type: 'VIDEO',
            videoUrl: 'https://www.youtube.com/watch?v=DHvZLI7Db8E',
            durationMinutes: 25,
          },
          {
            categoryId: backendCategory.id,
            authorId: teacher.id,
            title: 'Транзакции в Prisma',
            description: 'Атомарные операции для баланса, остатков и заявок.',
            type: 'DOCUMENT',
            content:
              'prisma.$transaction позволяет выполнить несколько операций атомарно. Внутри интерактивной транзакции можно прочитать баланс, проверить остаток, списать монеты и создать заявку: при любом исключении база откатится, а повторная отправка не спишет деньги дважды.',
            durationMinutes: 15,
          },
        ],
      })
    }
  }

  if ((await prisma.lead.count()) === 0) {
    await prisma.lead.createMany({
      data: [
        {
          name: 'Айпери Жумабекова',
          phone: '+996700111222',
          email: 'aiperi@example.kg',
          audience: 'PARENT',
          message: 'Интересует курс по фронтенд-разработке для дочери, 10 класс.',
          status: 'NEW',
          source: 'LANDING',
          consentAt: new Date(),
          assignedToId: manager.id,
        },
        {
          name: 'Данияр Абдылдаев',
          phone: '+996700333444',
          audience: 'STUDENT',
          message: 'Хочу записаться на мобильную разработку, есть опыт в JavaScript.',
          status: 'CONTACTED',
          source: 'LANDING',
          consentAt: new Date(),
          contactedAt: new Date(),
          assignedToId: manager.id,
        },
        {
          name: 'ОсОО «Нур Тех»',
          phone: '+996312555666',
          email: 'hr@nurtech.example.kg',
          audience: 'PARTNER',
          message: 'Хотим обсудить корпоративное обучение для команды из 12 человек.',
          status: 'NEW',
          source: 'REFERRAL',
          consentAt: new Date(),
        },
      ],
    })
  }

  // Стоимость обучения: фиксированная цена курса и модель оплаты.
  const priceCatalog: Array<{
    slug: string
    priceKgs: number
    billing: 'FULL' | 'MONTHLY' | 'INSTALLMENT'
    installmentsCount?: number
  }> = [
    { slug: 'react-native-start', priceKgs: 4500, billing: 'MONTHLY' },
    { slug: 'javascript-basics', priceKgs: 3500, billing: 'FULL' },
    { slug: 'python-start', priceKgs: 3000, billing: 'FULL' },
    { slug: 'react-professional', priceKgs: 5500, billing: 'INSTALLMENT', installmentsCount: 3 },
    { slug: 'backend-node', priceKgs: 6000, billing: 'MONTHLY' },
    { slug: 'ui-design-basics', priceKgs: 2800, billing: 'FULL' },
  ]

  for (const price of priceCatalog) {
    const pricedCourse = await prisma.course.findUnique({ where: { slug: price.slug }, select: { id: true, priceKgs: true } })
    if (!pricedCourse || pricedCourse.priceKgs !== 0) continue
    await prisma.course.update({
      where: { id: pricedCourse.id },
      data: {
        priceKgs: price.priceKgs,
        billing: price.billing,
        installmentsCount: price.billing === 'INSTALLMENT' ? Math.max(2, price.installmentsCount ?? 2) : 1,
      },
    })
    await prisma.coursePriceHistory.create({
      data: { courseId: pricedCourse.id, previousPrice: 0, newPrice: price.priceKgs, changedById: admin.id },
    })
  }

  // Демо-счёт с частичной оплатой: финансовый кабинет не пуст при первом запуске.
  if ((await prisma.invoice.count()) === 0) {
    const demoCourse = await prisma.course.findUnique({ where: { slug: 'react-native-start' }, select: { id: true } })
    const year = new Date().getUTCFullYear()
    const number = `INV-${year}-000001`
    await prisma.invoiceSequence.upsert({ where: { year }, update: { lastNumber: 1 }, create: { year, lastNumber: 1 } })

    const demoInvoice = await prisma.invoice.create({
      data: {
        number,
        studentId: student.id,
        courseId: demoCourse?.id,
        description: 'Оплата обучения за месяц',
        amount: 4500,
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'PARTIALLY_PAID',
        issuedById: admin.id,
      },
    })

    await prisma.payment.create({
      data: {
        invoiceId: demoInvoice.id,
        amount: 1500,
        method: 'CASH',
        status: 'CONFIRMED',
        note: 'Демо-платёж в кассе',
        registeredById: manager.id,
        confirmedById: admin.id,
        confirmedAt: new Date(),
      },
    })
  }

  console.log('Seed завершён. Демо-аккаунты (пароль ITadis2026):')
  console.log(`  admin:   ${admin.email}`)
  console.log(`  manager: ${manager.email}`)
  console.log(`  teacher: ${teacher.email}`)
  console.log(`  student: ${student.email}`)
  console.log(`  parent:  ${parent.email} (родитель ${student.firstName})`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
