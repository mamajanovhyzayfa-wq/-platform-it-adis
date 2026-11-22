import { Module } from '@nestjs/common'
import { HomeworkModule } from '../homework/homework.module.js'
import { TestsModule } from '../tests/tests.module.js'
import { ExamsModule } from '../exams/exams.module.js'

/**
 * Академический домен: домашние задания, тесты и экзамены.
 * Сам не объявляет маршрутов — только собирает три самостоятельных модуля.
 */
@Module({
  imports: [HomeworkModule, TestsModule, ExamsModule],
  exports: [HomeworkModule, TestsModule, ExamsModule],
})
export class AssessmentModule {}
