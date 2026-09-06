import type { ReactNode } from 'react'

export function Field({
  label,
  hint,
  icon,
  children,
}: {
  label: string
  hint?: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="field">
      <div className="field-head">
        <label>
          {icon}
          {label}
        </label>
        {hint && <span className="hint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? 'on' : ''}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format: (v: number) => string
}) {
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{format(value)}</output>
    </div>
  )
}

export function Sheet({
  title,
  onClose,
  actions,
  children,
}: {
  title: string
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <div className="sheet-actions">
            {actions}
            <button className="mini" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
