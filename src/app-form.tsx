import type { AppFormProps } from '@opencroft/client/app'
import { SecretSelector } from '@opencroft/client/secrets'
import { useState } from 'react'

// Custom parameter form for the Documentation App — the extension-owned
// replacement for the host's generic one. Controlled: the host owns the
// dialog and the submit; this only renders and reports values.
//
// Authentication follows the usual private-repo flow (as when installing an
// extension from a private repository): public by default, or an access
// token picked from the Secrets Store, with an optional username for hosts
// that require a real one.

interface FieldProps {
  id: string
  label: string
  value: string
  placeholder?: string
  required?: boolean
  onChange: (value: string) => void
}

function Field({ id, label, value, placeholder, required, onChange }: FieldProps) {
  return (
    <div className='flex w-full flex-col gap-1'>
      <label htmlFor={`docs-app-${id}`} className='text-sm font-medium'>
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        id={`docs-app-${id}`}
        className='w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function DocsAppForm({ params, onChange }: AppFormProps) {
  const [withToken, setWithToken] = useState(Boolean(params.tokenSecret))
  const set = (id: string) => (value: string) => onChange({ ...params, [id]: value })

  function setAuthMode(next: boolean) {
    setWithToken(next)
    if (!next) {
      onChange({ ...params, tokenSecret: '', username: '' })
    }
  }

  return (
    <div className='flex w-full flex-col gap-3'>
      <Field
        id='repoUrl'
        label='Repository URL'
        required
        value={params.repoUrl ?? ''}
        placeholder='https://example.com/docs.git'
        onChange={set('repoUrl')}
      />
      <Field id='branch' label='Branch' value={params.branch ?? ''} placeholder='main' onChange={set('branch')} />

      <div className='flex w-full flex-col gap-1'>
        <span className='text-sm font-medium'>Authentication</span>
        <div className='flex gap-1 rounded-md border p-0.5'>
          <button
            type='button'
            className={`flex-1 rounded px-2 py-1 text-sm ${withToken ? 'hover:bg-accent' : 'bg-accent font-medium'}`}
            onClick={() => setAuthMode(false)}
          >
            Public
          </button>
          <button
            type='button'
            className={`flex-1 rounded px-2 py-1 text-sm ${withToken ? 'bg-accent font-medium' : 'hover:bg-accent'}`}
            onClick={() => setAuthMode(true)}
          >
            Access token
          </button>
        </div>
      </div>

      {withToken && (
        <>
          <Field
            id='username'
            label='Username'
            value={params.username ?? ''}
            placeholder='x-access-token'
            onChange={set('username')}
          />
          <div className='flex w-full flex-col gap-1'>
            <span className='text-sm font-medium'>Access token *</span>
            <SecretSelector
              value={params.tokenSecret ?? ''}
              onChange={set('tokenSecret')}
              placeholder='Select the secret holding the token'
            />
            <p className='text-xs text-muted-foreground'>
              Only the key is stored; the value stays in the Secrets Store.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
