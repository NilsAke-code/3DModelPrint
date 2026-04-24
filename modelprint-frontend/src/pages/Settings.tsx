import { useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { Camera, Save, User } from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import { updateUserProfile, uploadUserAvatar } from '../services/api';

export default function Settings() {
  const isAuthenticated = useIsAuthenticated();
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return <SettingsForm />;
}

function SettingsForm() {
  const { user, refreshUser } = useUser();
  const { accounts } = useMsal();
  const msalEmail = accounts[0]?.username ?? accounts[0]?.name ?? user?.email ?? '';

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.profilePictureUrl ?? null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials = (displayName || msalEmail)
    .split(' ')
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Display name cannot be empty.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await updateUserProfile(displayName.trim());
      if (pendingFile) {
        const { url } = await uploadUserAvatar(pendingFile);
        setAvatarPreview(url + '?t=' + Date.now());
        setPendingFile(null);
      }
      refreshUser();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-text-primary mb-6">Settings</h1>

      <div className="bg-bg-card border border-border rounded-xl p-6">
        <form onSubmit={handleSave} className="flex flex-col gap-5">

          {/* Avatar */}
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative w-20 h-20 rounded-full group focus:outline-none"
            >
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt="Avatar"
                  className="w-20 h-20 rounded-full object-cover border border-border"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-accent text-2xl font-bold select-none">
                  {initials || <User size={32} />}
                </div>
              )}
              <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera size={20} className="text-white" />
              </div>
            </button>
            <span className="text-xs text-text-secondary">Click to change picture</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Display name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-secondary">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="bg-input-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
              placeholder="Your display name"
              maxLength={100}
            />
          </div>

          {/* Email — read only */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-secondary">Email</label>
            <input
              type="email"
              value={msalEmail}
              readOnly
              className="bg-input-bg border border-border rounded-lg px-3 py-2 text-sm text-text-secondary cursor-not-allowed opacity-60"
            />
            <p className="text-xs text-text-secondary">Managed by your Microsoft account.</p>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {success && <p className="text-[#4ade80] text-sm">Saved successfully.</p>}

          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            <Save size={15} />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
}
