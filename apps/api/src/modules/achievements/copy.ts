/** Текст уведомления о достижении: награда упоминается только если она есть. */
export function notificationBody(title: string, rewardCoins: number): string {
  return rewardCoins > 0 ? `«${title}» — награда ${rewardCoins} изикоинов` : `Получено достижение «${title}»`
}
