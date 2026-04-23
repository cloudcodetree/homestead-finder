import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSavedListings } from '../hooks/useSavedListings';

interface PrivateNoteProps {
  listingId: string;
}

/**
 * Debounced textarea that writes back to saved_listings.note.
 *
 * Renders only for signed-in users who have saved the listing —
 * gating both states avoids the UX where a user types, realizes
 * they aren't saved, and loses the note.
 *
 * Save cadence: 1s after the last keystroke, OR on blur, OR when
 * the component unmounts. Optimistic — the local `value` state
 * reflects user input immediately; the provider's note map reflects
 * server state.
 */
export const PrivateNote = ({ listingId }: PrivateNoteProps) => {
  const { user } = useAuth();
  const { isSaved, getNote, updateNote } = useSavedListings();
  const saved = isSaved(listingId);
  const persisted = getNote(listingId);
  const [value, setValue] = useState(persisted);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle'
  );
  const timerRef = useRef<number | null>(null);
  const lastSavedRef = useRef(persisted);

  // If the provider's persisted note changes externally (e.g. another
  // tab saved), pull it in — but ONLY when the user hasn't got an
  // unsaved edit in flight.
  useEffect(() => {
    if (value === lastSavedRef.current) {
      setValue(persisted);
      lastSavedRef.current = persisted;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persisted]);

  const commit = async (next: string) => {
    if (next === lastSavedRef.current) return;
    setStatus('saving');
    try {
      await updateNote(listingId, next);
      lastSavedRef.current = next;
      setStatus('saved');
      window.setTimeout(() => setStatus('idle'), 1500);
    } catch {
      setStatus('error');
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => commit(next), 1000);
  };

  const onBlur = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void commit(value);
  };

  // Flush on unmount — React strict-mode double-mount is OK here
  // since `commit` is a no-op when value === lastSaved.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        void commit(value);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user || !saved) return null;

  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between mb-1">
        <label
          htmlFor={`note-${listingId}`}
          className="text-gray-500 text-xs"
        >
          Private note (only you see this)
        </label>
        <span className="text-[11px] text-gray-400">
          {status === 'saving' && 'Saving…'}
          {status === 'saved' && '✓ Saved'}
          {status === 'error' && (
            <span className="text-red-500">Couldn't save</span>
          )}
        </span>
      </div>
      <textarea
        id={`note-${listingId}`}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        rows={3}
        maxLength={2000}
        placeholder="Anything you want to remember about this parcel — water, access, offer status, neighbors…"
        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500 resize-y"
      />
    </div>
  );
};
