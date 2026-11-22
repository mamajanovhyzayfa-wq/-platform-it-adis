import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { LmsBlock } from '../api/lms'

/**
 * Отображение блоков урока: предпросмотр курса и ученический плеер.
 * Редактор блоков живёт в конструкторе урока.
 */

function isEmbeddable(url: string): boolean {
  return /youtube\.com|youtu\.be|vimeo\.com/i.test(url)
}

function embedUrl(url: string): string | null {
  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/)
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`
  const vimeo = url.match(/vimeo\.com\/(\d+)/)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`
  return null
}

function InteractiveBlock({ block }: { block: LmsBlock }) {
  const [picked, setPicked] = useState<number | null>(null)
  const options = block.options ?? []
  const answered = picked !== null
  const correct = block.correctOption

  return (
    <div className="block block-interactive">
      <strong>{block.title || 'Проверьте себя'}</strong>
      {block.prompt ? <p>{block.prompt}</p> : null}
      <div className="interactive-options">
        {options.map((option, index) => {
          const tone =
            answered && correct !== undefined
              ? index === correct
                ? 'interactive-correct'
                : index === picked
                  ? 'interactive-wrong'
                  : ''
              : picked === index
                ? 'interactive-picked'
                : ''
          return (
            <button
              key={`${block.id}-${index}`}
              type="button"
              className={`interactive-option ${tone}`}
              onClick={() => setPicked(index)}
              disabled={answered}
            >
              {option}
            </button>
          )
        })}
      </div>
      {answered ? (
        <p className="muted small" role="status">
          {correct === undefined
            ? 'Ответ сохранён.'
            : picked === correct
              ? 'Верно!'
              : 'Пока неверно — вернитесь к материалу и попробуйте ещё раз.'}
        </p>
      ) : null}
    </div>
  )
}

export function LessonBlockView({
  block,
  studentMode = false,
  testIds,
}: {
  block: LmsBlock
  studentMode?: boolean
  testIds?: string[]
}) {
  switch (block.type) {
    case 'text':
      return (
        <article className="block block-text">
          {block.title ? <h3>{block.title}</h3> : null}
          {(block.text ?? '').split('\n').filter(Boolean).map((line, index) => (
            <p key={`${block.id}-${index}`}>{line}</p>
          ))}
        </article>
      )

    case 'image':
      return (
        <figure className="block block-media">
          {block.title ? <figcaption>{block.title}</figcaption> : null}
          {block.url ? <img src={block.url} alt={block.caption || block.title || ''} loading="lazy" /> : null}
          {block.caption ? <figcaption className="muted small">{block.caption}</figcaption> : null}
        </figure>
      )

    case 'video':
      return (
        <div className="block block-media">
          {block.title ? <h3>{block.title}</h3> : null}
          {block.url ? (
            isEmbeddable(block.url) && embedUrl(block.url) ? (
              <div className="video-embed">
                <iframe
                  src={embedUrl(block.url) ?? ''}
                  title={block.title || 'Видео урока'}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <video controls preload="metadata" src={block.url}>
                <track kind="captions" />
              </video>
            )
          ) : null}
          {block.caption ? <p className="muted small">{block.caption}</p> : null}
        </div>
      )

    case 'audio':
      return (
        <div className="block block-media">
          {block.title ? <h3>{block.title}</h3> : null}
          {block.url ? <audio controls preload="metadata" src={block.url} /> : null}
          {block.caption ? <p className="muted small">{block.caption}</p> : null}
        </div>
      )

    case 'pdf':
    case 'presentation':
    case 'document':
    case 'file':
    case 'link':
      return (
        <div className="block block-file">
          <span className="file-type">{block.type.toUpperCase()}</span>
          <div>
            <strong>{block.title || block.url}</strong>
            {block.description ? <p className="muted small">{block.description}</p> : null}
          </div>
          {block.url ? (
            <a
              className="button button-ghost button-small"
              href={block.url}
              download={block.type !== 'link' && block.allowDownload !== false ? '' : undefined}
              target="_blank"
              rel="noreferrer"
            >
              {block.type === 'link' || block.allowDownload === false ? 'Открыть' : 'Скачать'}
            </a>
          ) : null}
        </div>
      )

    case 'assignment':
      return (
        <div className="block block-note">
          <span className="badge">Задание</span>
          <strong>{block.title || 'Задание'}</strong>
          {block.description ? <p>{block.description}</p> : null}
          {block.dueAt ? <p className="muted small">Срок: {new Date(block.dueAt).toLocaleString('ru-RU')}</p> : null}
          {studentMode && block.homeworkId ? (
            <Link className="button button-ghost button-small" to="/homework">
              Открыть задание
            </Link>
          ) : null}
        </div>
      )

    case 'test':
      return (
        <div className="block block-note">
          <span className="badge">Тест</span>
          <strong>{block.title || 'Тест по уроку'}</strong>
          {block.description ? <p>{block.description}</p> : null}
          {studentMode && block.testId && testIds?.includes(block.testId) ? (
            <Link className="button button-small" to={`/tests/${block.testId}/take`}>
              Пройти тест
            </Link>
          ) : null}
        </div>
      )

    case 'interactive':
      return <InteractiveBlock block={block} />

    default:
      return null
  }
}

export function LessonBlocks({
  blocks,
  studentMode = false,
  testIds,
}: {
  blocks: LmsBlock[]
  studentMode?: boolean
  testIds?: string[]
}) {
  if (blocks.length === 0) return <p className="empty">В уроке пока нет материалов.</p>
  return (
    <div className="blocks">
      {blocks.map((block) => (
        <LessonBlockView key={block.id} block={block} studentMode={studentMode} testIds={testIds} />
      ))}
    </div>
  )
}

export const blockLabels: Record<LmsBlock['type'], string> = {
  text: 'Текст',
  image: 'Изображение',
  video: 'Видео',
  audio: 'Аудио',
  document: 'Документ',
  file: 'Файл',
  pdf: 'PDF',
  presentation: 'Презентация',
  link: 'Ссылка',
  assignment: 'Задание',
  test: 'Тест',
  interactive: 'Интерактив',
}
