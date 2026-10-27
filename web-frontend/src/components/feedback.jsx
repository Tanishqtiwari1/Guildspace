/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Modal } from './ui.jsx'

const FeedbackContext = createContext(null)

/** Toasts and promise-based confirmation dialogs, available anywhere via useToast() / useConfirm(). */
export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [dialog, setDialog] = useState(null)
  const nextId = useRef(1)

  const toast = useCallback((text, kind = 'success') => {
    const id = nextId.current++
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  const confirm = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, resolve })), [])

  const close = (answer) => {
    dialog?.resolve(answer)
    setDialog(null)
  }

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
            {t.kind === 'error' ? '⚠ ' : '✓ '}{t.text}
          </div>
        ))}
      </div>
      {dialog && (
        <Modal title={dialog.title} onClose={() => close(false)}>
          {dialog.body && <div style={{ marginBottom: 16 }}>{dialog.body}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => close(false)}>{dialog.cancelLabel || 'Cancel'}</button>
            <button className={`btn ${dialog.danger ? 'danger' : ''}`} onClick={() => close(true)} autoFocus>{dialog.confirmLabel || 'Confirm'}</button>
          </div>
        </Modal>
      )}
    </FeedbackContext.Provider>
  )
}

export const useToast = () => useContext(FeedbackContext).toast
export const useConfirm = () => useContext(FeedbackContext).confirm
