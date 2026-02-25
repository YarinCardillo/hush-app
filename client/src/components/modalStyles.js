/** Shared inline styles for modal dialogs (Create Server, Create Channel, Join Server, etc.) */
const modalStyles = {
  title: {
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    marginBottom: '12px',
  },
  fieldLabel: {
    display: 'block',
    marginBottom: '4px',
    fontSize: '0.8rem',
    color: 'var(--hush-text-secondary)',
    fontWeight: 500,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  error: {
    fontSize: '0.85rem',
    color: 'var(--hush-danger)',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  },
};

export default modalStyles;
