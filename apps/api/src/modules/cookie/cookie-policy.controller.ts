import { Controller, Get } from '@nestjs/common'
import { Public } from '../../nest/common/decorators.js'

/** Публичная политика cookie: версия и категории должны совпадать с ConsentType. */
@Controller('api/cookies')
export class CookiePolicyController {
  @Public()
  @Get('policy')
  policy() {
    return {
      version: '2026-11',
      updatedAt: '2026-11-20',
      categories: [
        { type: 'COOKIES', required: true, title: 'Необходимые', description: 'Сессия, безопасность, выбор языка.' },
        { type: 'COOKIE_FUNCTIONAL', required: false, title: 'Функциональные', description: 'Персональные настройки интерфейса.' },
        { type: 'COOKIE_ANALYTICS', required: false, title: 'Аналитические', description: 'Обезличенная статистика использования.' },
        { type: 'COOKIE_MARKETING', required: false, title: 'Маркетинговые', description: 'Реклама и измерение кампаний.' },
      ],
    }
  }
}
