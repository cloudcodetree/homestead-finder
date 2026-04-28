import { useState } from 'react';

interface NotificationPrefs {
  email: string;
  minScore: number;
  states: string[];
  enabled: boolean;
}

const STORAGE_KEY = 'homestead-finder-notifications';

const loadPrefs = (): NotificationPrefs => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as NotificationPrefs;
  } catch {
    // ignore
  }
  return { email: '', minScore: 75, states: [], enabled: false };
};

interface NotificationSettingsProps {
  /** Called when the user clicks Cancel — page wrapper navigates back. */
  onClose: () => void;
}

export const NotificationSettings = ({ onClose }: NotificationSettingsProps) => {
  const [prefs, setPrefs] = useState<NotificationPrefs>(loadPrefs);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-auto">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Deal Notifications</h2>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">Email Alerts</p>
              <p className="text-sm text-gray-500">Get notified when hot deals appear</p>
            </div>
            <button
              onClick={() => setPrefs((p) => ({ ...p, enabled: !p.enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                prefs.enabled ? 'bg-green-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  prefs.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {prefs.enabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={prefs.email}
                  onChange={(e) => setPrefs((p) => ({ ...p, email: e.target.value }))}
                  placeholder="you@example.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Min Deal Score: <span className="text-green-600 font-bold">{prefs.minScore}</span>
                </label>
                <input
                  type="range"
                  min={50}
                  max={100}
                  step={5}
                  value={prefs.minScore}
                  onChange={(e) => setPrefs((p) => ({ ...p, minScore: Number(e.target.value) }))}
                  className="w-full accent-green-600"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>50 (Fair+)</span>
                  <span>75 (Good+)</span>
                  <span>90 (Hot only)</span>
                </div>
              </div>
            </>
          )}

          <p className="text-xs text-gray-400 bg-gray-50 rounded p-3">
            Notifications are sent via the GitHub Actions scraper. Your email is stored locally and
            must also be configured as the <code>NOTIFICATION_EMAIL</code> secret in the GitHub
            repo.
          </p>
        </div>

        <div className="p-5 border-t border-gray-100 flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg transition-colors"
          >
            {saved ? 'Saved!' : 'Save Preferences'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
