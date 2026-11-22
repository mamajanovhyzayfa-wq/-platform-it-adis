import { Modal } from './ui.jsx'
import { LeadForm } from './LeadForm.jsx'

/** Публичная заявка на обучение: сохраняется в CRM backend, а не в localStorage. */
export function ApplicationModal({ open, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Подать заявку"
      subtitle="Расскажите о себе — менеджер свяжется и подберёт формат обучения."
      size="sm"
    >
      <LeadForm onDone={onClose} />
    </Modal>
  )
}
