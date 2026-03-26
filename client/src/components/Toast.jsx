import { AnimatePresence, motion } from 'motion/react';

/** Border colors for each toast type, using design-system status palette. */
const TYPE_BORDER = {
  success: 'var(--hush-live)',
  error: 'var(--hush-danger)',
  info: 'var(--hush-amber)',
};

/**
 * Renders the active toast stack in the bottom-right corner.
 * Expects the `toasts` array from `useToast`.
 *
 * @param {{ toasts: Array<{ id: number, message: string, type: string }> }} props
 */
export default function Toast({ toasts }) {
  return (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className="toast-item"
            style={{ borderLeft: `3px solid ${TYPE_BORDER[t.type] ?? TYPE_BORDER.info}` }}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
