import { AnimatePresence, motion } from 'motion/react';

/** Border colors for each toast type, using design-system status palette. */
const TYPE_BORDER = {
  success: 'var(--hush-live)',
  error: 'var(--hush-danger)',
  info: 'var(--hush-amber)',
};

const styles = {
  container: {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    zIndex: 9999,
    pointerEvents: 'none',
  },
  toast: (type) => ({
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    background: 'var(--hush-surface)',
    borderLeft: `3px solid ${TYPE_BORDER[type] ?? TYPE_BORDER.info}`,
    fontSize: '0.85rem',
    color: 'var(--hush-text)',
    maxWidth: '340px',
    pointerEvents: 'auto',
    // Glass effect per design-system overlay pattern
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
  }),
};

/**
 * Renders the active toast stack in the bottom-right corner.
 * Expects the `toasts` array from `useToast`.
 *
 * @param {{ toasts: Array<{ id: number, message: string, type: string }> }} props
 */
export default function Toast({ toasts }) {
  return (
    <div style={styles.container} aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            style={styles.toast(t.type)}
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
