import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  groupId: string;
  sessionId: string;
  onUploaded: (path: string) => void;
  value: string | null;
}

export function BillUpload({ groupId, sessionId, onUploaded, value }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (!ACCEPTED.includes(file.type)) {
      setError('Only PDF, JPG, PNG, WEBP, or HEIC files are accepted.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('File is too large (10 MB max).');
      return;
    }

    setUploading(true);
    const path = `${groupId}/${sessionId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('bills').upload(path, file);
    setUploading(false);

    if (uploadError) {
      setError(uploadError.message);
      return;
    }
    onUploaded(path);
  };

  return (
    <div>
      <label className="label-eyebrow block mb-1.5">Bill (optional)</label>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="btn-secondary w-full text-left flex items-center justify-between"
      >
        <span className="truncate">
          {uploading ? 'Uploading…' : value ? value.split('-').slice(1).join('-') : 'Attach PDF or photo'}
        </span>
        <span className="text-ink-faint">📎</span>
      </button>
      {error ? <p className="text-brick text-xs mt-1">{error}</p> : null}
    </div>
  );
}
