import { describe, expect, it } from 'vitest'
import {
  COIN_RULES,
  eventPlaceCoinReward,
  homeworkCoinReward,
  testCoinReward,
} from '../src/lib/coins.js'

describe('IT Coins: фиксированные правила', () => {
  it('посещение занятия даёт три монеты', () => {
    expect(COIN_RULES.attendance).toBe(3)
  })

  it('домашняя работа даёт базовую награду и бонус за результат', () => {
    expect(homeworkCoinReward(5, 10)).toBe(COIN_RULES.homeworkBase)
    expect(homeworkCoinReward(7, 10)).toBe(COIN_RULES.homeworkBase + COIN_RULES.homeworkGood)
    expect(homeworkCoinReward(9, 10)).toBe(COIN_RULES.homeworkBase + COIN_RULES.homeworkExcellent)
    expect(homeworkCoinReward(0, 0)).toBe(COIN_RULES.homeworkBase)
  })

  it('тест даёт базовую награду и бонус за результат', () => {
    expect(testCoinReward(50)).toBe(COIN_RULES.testBase)
    expect(testCoinReward(70)).toBe(COIN_RULES.testBase + COIN_RULES.testGood)
    expect(testCoinReward(90)).toBe(COIN_RULES.testBase + COIN_RULES.testExcellent)
  })

  it('призовые места оплачиваются только за первое, второе и третье место', () => {
    expect(eventPlaceCoinReward(1)).toBe(COIN_RULES.eventFirstPlace)
    expect(eventPlaceCoinReward(2)).toBe(COIN_RULES.eventSecondPlace)
    expect(eventPlaceCoinReward(3)).toBe(COIN_RULES.eventThirdPlace)
    expect(eventPlaceCoinReward(4)).toBe(0)
    expect(eventPlaceCoinReward(null)).toBe(0)
  })
})
