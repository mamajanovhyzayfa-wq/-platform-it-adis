import type { CoinSource, Prisma } from '@prisma/client'

/**
 * IT Coins: единственная точка начисления.
 *
 * Баланс и запись в журнале меняются в одной транзакции вызывающего кода,
 * поэтому расхождений между `CoinBalance` и `CoinTransaction` не бывает.
 * Для учебных действий передаётся `sourceType` + `sourceId`: уникальный ключ
 * `[userId, sourceType, sourceId]` не даст начислить награду дважды, даже если
 * запрос повторится.
 */

export interface AwardCoinsInput {
  userId: string
  amount: number
  reason: string
  sourceType?: CoinSource
  /** Идентификатор действия: homeworkId, testId, courseId, eventId или scheduleId. */
  sourceId?: string | null
  awardedById?: string | null
}

export interface AwardCoinsResult {
  awarded: boolean
  balance: number
}

// Академические баллы и IT Coins не связаны: награды за оценки здесь не рассчитываются.
// Суммы фиксированы сервером, чтобы клиент не мог подменить размер начисления.

/** Фиксированные награды за действия. */
export const COIN_RULES = {
  attendance: 3,
  homeworkBase: 10,
  homeworkGood: 5,
  homeworkExcellent: 10,
  testBase: 10,
  testGood: 5,
  testExcellent: 10,
  courseCompleted: 100,
  eventParticipation: 15,
  eventFirstPlace: 50,
  eventSecondPlace: 30,
  eventThirdPlace: 20,
} as const

/** Проверенная работа: базовая награда и бонус за хороший/отличный результат. */
export function homeworkCoinReward(score: number, maxScore: number): number {
  const percent = maxScore <= 0 ? 0 : Math.round((Math.max(0, score) / maxScore) * 100)
  return COIN_RULES.homeworkBase +
    (percent >= 90 ? COIN_RULES.homeworkExcellent : percent >= 70 ? COIN_RULES.homeworkGood : 0)
}

/** Завершённый тест: базовая награда и бонус за хороший/отличный результат. */
export function testCoinReward(percent: number): number {
  return COIN_RULES.testBase +
    (percent >= 90 ? COIN_RULES.testExcellent : percent >= 70 ? COIN_RULES.testGood : 0)
}

/** Награда за призовое место на мероприятии/соревновании. */
export function eventPlaceCoinReward(place: number | null | undefined): number {
  if (place === 1) return COIN_RULES.eventFirstPlace
  if (place === 2) return COIN_RULES.eventSecondPlace
  if (place === 3) return COIN_RULES.eventThirdPlace
  return 0
}

export async function awardCoins(
  tx: Prisma.TransactionClient,
  input: AwardCoinsInput,
): Promise<AwardCoinsResult> {
  const amount = Math.trunc(input.amount)
  if (amount <= 0) {
    const current = await tx.coinBalance.findUnique({ where: { userId: input.userId } })
    return { awarded: false, balance: current?.balance ?? 0 }
  }

  const sourceType = input.sourceType ?? 'MANUAL'
  const sourceId = input.sourceId ?? null

  // skipDuplicates опирается на уникальный ключ и не роняет транзакцию при повторе.
  let createdId: string | null = null
  if (sourceId) {
    const created = await tx.coinTransaction.createMany({
      data: [
        {
          userId: input.userId,
          amount,
          reason: input.reason,
          sourceType,
          sourceId,
          awardedById: input.awardedById ?? null,
        },
      ],
      skipDuplicates: true,
    })
    if (created.count === 0) {
      const current = await tx.coinBalance.findUnique({ where: { userId: input.userId } })
      return { awarded: false, balance: current?.balance ?? 0 }
    }
  } else {
    const created = await tx.coinTransaction.create({
      data: {
        userId: input.userId,
        amount,
        reason: input.reason,
        sourceType,
        sourceId: null,
        awardedById: input.awardedById ?? null,
      },
      select: { id: true },
    })
    createdId = created.id
  }

  const balance = await tx.coinBalance.upsert({
    where: { userId: input.userId },
    update: { balance: { increment: amount } },
    create: { userId: input.userId, balance: amount },
  })

  // Итоговый баланс фиксируется в самой операции — история остаётся воспроизводимой.
  if (sourceId) {
    await tx.coinTransaction.updateMany({
      where: { userId: input.userId, sourceType, sourceId },
      data: { balanceAfter: balance.balance },
    })
  } else if (createdId) {
    await tx.coinTransaction.update({ where: { id: createdId }, data: { balanceAfter: balance.balance } })
  }

  return { awarded: true, balance: balance.balance }
}
