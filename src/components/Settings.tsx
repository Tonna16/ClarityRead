import  { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, User, Bell, Download, RefreshCw, Shield } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Switch from './ui/Switch';

export default function Settings() {
  const [settings, setSettings] = useState({
    notifications: true,
    darkMode: false,
    autoSave: true,
    soundEffects: false,
    analytics: true,
    betaFeatures: false
  });

  const handleSettingChange = (key: string, value: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    localStorage.setItem('clarityread-settings', JSON.stringify({ ...settings, [key]: value }));
  };

  const exportData = () => {
    const data = {
      savedTexts: JSON.parse(localStorage.getItem('savedTexts') || '[]'),
      settings: settings,
      exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clarityread-export-${Date.now()}.json`;
    a.click();
  };

  const resetData = () => {
    if (confirm('Are you sure you want to reset all data? This cannot be undone.')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4 mb-8"
        >
          <div className="p-3 bg-slate-600 text-white rounded-lg md-elevation-3">
            <SettingsIcon size={28} />
          </div>
          <div>
            <h1 className="md-headline-4 text-slate-900 dark:text-slate-100">Settings</h1>
            <p className="md-body-1 text-slate-600 dark:text-slate-400">Customize your reading experience</p>
          </div>
        </motion.div>

        <div className="md-grid md-grid-12 gap-6">
          {/* Account Settings */}
          <div className="col-span-12 lg:col-span-6">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card elevation={3}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-blue-600 text-white rounded-lg">
                      <User size={20} />
                    </div>
                    <h3 className="md-headline-6">Account & Profile</h3>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="block md-body-2 text-slate-700 dark:text-slate-300 mb-2">
                        Display Name
                      </label>
                      <input
                        type="text"
                        placeholder="Your Name"
                        className="w-full px-4 py-3 border-2 border-slate-300 dark:border-slate-600 rounded md-surface focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-all duration-200 md-standard"
                      />
                    </div>

                    <div>
                      <label className="block md-body-2 text-slate-700 dark:text-slate-300 mb-2">
                        Email
                      </label>
                      <input
                        type="email"
                        placeholder="your@email.com"
                        className="w-full px-4 py-3 border-2 border-slate-300 dark:border-slate-600 rounded md-surface focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-all duration-200 md-standard"
                      />
                    </div>

                    <Button variant="contained" color="primary">
                      Update Profile
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          </div>

          {/* Preferences */}
          <div className="col-span-12 lg:col-span-6">
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card elevation={3}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-purple-600 text-white rounded-lg">
                      <Bell size={20} />
                    </div>
                    <h3 className="md-headline-6">Preferences</h3>
                  </div>

                  <div className="space-y-6">
                    <Switch
                      id="notifications"
                      checked={settings.notifications}
                      onChange={(checked) => handleSettingChange('notifications', checked)}
                      label="Notifications"
                      description="Receive reading reminders and updates"
                    />

                    <Switch
                      id="auto-save"
                      checked={settings.autoSave}
                      onChange={(checked) => handleSettingChange('autoSave', checked)}
                      label="Auto-save texts"
                      description="Automatically save your reading progress"
                    />

                    <Switch
                      id="sound-effects"
                      checked={settings.soundEffects}
                      onChange={(checked) => handleSettingChange('soundEffects', checked)}
                      label="Sound effects"
                      description="Play sounds for interactions"
                    />

                    <Switch
                      id="analytics"
                      checked={settings.analytics}
                      onChange={(checked) => handleSettingChange('analytics', checked)}
                      label="Analytics tracking"
                      description="Track reading statistics and progress"
                    />

                    <Switch
                      id="beta-features"
                      checked={settings.betaFeatures}
                      onChange={(checked) => handleSettingChange('betaFeatures', checked)}
                      label="Beta features"
                      description="Enable experimental features"
                    />
                  </div>
                </div>
              </Card>
            </motion.div>
          </div>

          {/* Data Management */}
          <div className="col-span-12 lg:col-span-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Card elevation={3}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-green-600 text-white rounded-lg">
                      <Download size={20} />
                    </div>
                    <h3 className="md-headline-6">Data Management</h3>
                  </div>

                  <div className="space-y-4">
                    <Button
                      onClick={exportData}
                      variant="outlined"
                      color="primary"
                      className="w-full"
                    >
                      <Download size={18} />
                      Export All Data
                    </Button>

                    <Button
                      onClick={resetData}
                      variant="outlined"
                      color="error"
                      className="w-full"
                    >
                      <RefreshCw size={18} />
                      Reset All Data
                    </Button>

                    <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield size={16} className="text-orange-600" />
                        <span className="md-body-2 font-semibold text-orange-800 dark:text-orange-400">
                          Privacy Note
                        </span>
                      </div>
                      <p className="md-caption text-orange-700 dark:text-orange-500">
                        All your data is stored locally in your browser. We don't collect or store any personal information on our servers.
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          </div>

          {/* About */}
          <div className="col-span-12 lg:col-span-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <Card elevation={3}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-indigo-600 text-white rounded-lg">
                      <SettingsIcon size={20} />
                    </div>
                    <h3 className="md-headline-6">About ClarityRead</h3>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="md-body-2 text-slate-600 dark:text-slate-400 mb-1">Version</div>
                      <div className="md-body-1 font-semibold">1.0.0</div>
                    </div>

                    <div>
                      <div className="md-body-2 text-slate-600 dark:text-slate-400 mb-1">Built with</div>
                      <div className="md-body-1 font-semibold">React + TypeScript + Tailwind CSS</div>
                    </div>

                    <div>
                      <div className="md-body-2 text-slate-600 dark:text-slate-400 mb-1">Features</div>
                      <ul className="md-body-2 text-slate-700 dark:text-slate-300 space-y-1">
                        <li>• Speed reading with customizable settings</li>
                        <li>• Text-to-speech functionality</li>
                        <li>• AI-powered text summarization</li>
                        <li>• Reading analytics and progress tracking</li>
                        <li>• Dyslexia-friendly font options</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
 