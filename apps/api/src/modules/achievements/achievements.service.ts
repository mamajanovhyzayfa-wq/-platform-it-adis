import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { achievementProgress, evaluateAchievements } from './evaluate.js'

@Injectable()
export class AchievementsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const [achievements, earned] = await Promise.all([
      this.prisma.client.achievement.findMany({ orderBy: { title: 'asc' } }),
      this.prisma.client.userAchievement.findMany({ where: { userId } }),
    ])
    const earnedMap = new Map(earned.map((item) => [item.achievementId, item.awardedAt]))

    const items = await Promise.all(
      achievements.map(async (achievement) => {
        const { current, target } = await achievementProgress(userId, achievement.condition)
        return {
          id: achievement.id,
          code: achievement.code,
          title: achievement.title,
          description: achievement.description,
          iconUrl: achievement.iconUrl,
          current,
          target,
          earnedAt: earnedMap.get(achievement.id) ?? null,
        }
      }),
    )

    return { items, earned: earned.length, total: achievements.length }
  }

  async check(userId: string) {
    return { awarded: await evaluateAchievements(userId) }
  }
}
