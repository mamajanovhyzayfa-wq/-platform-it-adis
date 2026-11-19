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
  /** Идентификатор действия: submissionId, attemptId или scheduleId. */
  sourceId?: string | null
  awardedById?: string | null
}

export interface AwardCoinsResult {
  awarded: boolean
  balance: number
}

/** Награда за проверенную работу: 2–20 монет пропорционально баллу. */
export function homeworkReward(score: number, maxScore: number): number {
  if (score <= 0 || maxScore <= 0) return 0
  const ratio = Math.min(score / maxScore, 1)
  return Math.max(2, Math.round(ratio * 20))
}

/** Награда за пройденный тест: 10–20 монет по проценту правильных ответов. */
export function testReward(percent: number): number {
  if (percent <= 0) return 0
  return 10 + Math.min(10, Math.floor(percent / 10))
}

/** Фиксированные награды за действия. */
export const COIN_RULES = { attendance: 3 } as const

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
    skipDuplicates: Boolean(sourceId),
  })

  if (created.count === 0) {
    const current = await tx.coinBalance.findUnique({ where: { userId: input.userId } })
    return { awarded: false, balance: current?.balance ?? 0 }
  }

  const balance = await tx.coinBalance.upsert({
    where: { userId: input.userId },
    update: { balance: { increment: amount } },
    create: { userId: input.userId, balance: amount },
  })

  return { awarded: true, balance: balance.balance }
}
