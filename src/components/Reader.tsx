import  React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Square, Save, Volume2, VolumeX, RotateCcw, Settings, Zap, Book } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Textarea from './ui/Textarea';
import Slider from './ui/Slider';
import Switch from './ui/Switch';
import SavedItems from './SavedItems';

interface ReadingSettings {
  dyslexiaFont: boolean;
  fontSize: number;
  lineHeight: number;
  speedReading: boolean;
  chunkSize: number;
  readingSpeed: number;
  highlightWord: boolean;
}

export default function Reader() {
  const [text, setText] = useState('');
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [isReading, setIsReading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isSpeedReading, setIsSpeedReading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const [settings, setSettings] = useState<ReadingSettings>({
    dyslexiaFont: false,
    fontSize: 16,
    lineHeight: 1.6,
    speedReading: false,
    chunkSize: 3,
    readingSpeed: 300,
    highlightWord: true
  });

  const textRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout>();
  const speechRef = useRef<SpeechSynthesisUtterance>();

  const words = text.split(/\s+/).filter(word => word.length > 0);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      speechSynthesis.cancel();
    };
  }, []);

  const startReading = () => {
    if (words.length === 0) return;
    
    setIsReading(true);
    setIsPaused(false);
    
    if (settings.speedReading) {
      startSpeedReading();
    } else {
      startTextToSpeech();
    }
  };

  const pauseReading = () => {
    setIsPaused(true);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (isSpeaking) speechSynthesis.pause();
  };

  const resumeReading = () => {
    setIsPaused(false);
    if (settings.speedReading) {
      startSpeedReading();
    } else if (isSpeaking) {
      speechSynthesis.resume();
    }
  };

  const stopReading = () => {
    setIsReading(false);
    setIsPaused(false);
    setCurrentWordIndex(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
    speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const startSpeedReading = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    
    const interval = 60000 / settings.readingSpeed;
    intervalRef.current = setInterval(() => {
      setCurrentWordIndex(prev => {
        const next = prev + settings.chunkSize;
        if (next >= words.length) {
          stopReading();
          return prev;
        }
        return next;
      });
    }, interval);
  };

  const startTextToSpeech = () => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      speechRef.current = utterance;
      
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 0.8;
      
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        stopReading();
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        stopReading();
      };

      speechSynthesis.speak(utterance);
    }
  };

  const saveText = () => {
    if (!text.trim()) return;
    
    const savedTexts = JSON.parse(localStorage.getItem('savedTexts') || '[]');
    const newText = {
      id: Date.now(),
      title: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      text: text,
      createdAt: new Date().toISOString()
    };
    
    savedTexts.unshift(newText);
    localStorage.setItem('savedTexts', JSON.stringify(savedTexts.slice(0, 20)));
  };

  const loadText = (loadedText: string) => {
    setText(loadedText);
    stopReading();
  };

  const getCurrentChunk = () => {
    if (!settings.speedReading || currentWordIndex >= words.length) return '';
    return words.slice(currentWordIndex, currentWordIndex + settings.chunkSize).join(' ');
  };

  const renderTextWithHighlight = () => {
    if (!settings.highlightWord || !isReading || settings.speedReading) {
      return <div dangerouslySetInnerHTML={{ __html: text.replace(/\n/g, '<br/>') }} />;
    }

    return words.map((word, index) => (
      <span
        key={index}
        className={`${
          index === currentWordIndex 
            ? 'bg-yellow-200 dark:bg-yellow-600 px-1 rounded transition-all duration-300' 
            : ''
        }`}
      >
        {word}{' '}
      </span>
    ));
  };

  return (
    <div className="h-full overflow-hidden">
      <div className="h-full max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-600 text-white rounded-lg md-elevation-3">
              <Book size={28} />
            </div>
            <div>
              <h1 className="md-headline-4 text-slate-900 dark:text-slate-100">Reader</h1>
              <p className="md-body-1 text-slate-600 dark:text-slate-400">Enhanced reading experience</p>
            </div>
          </div>
          
          <motion.button
            onClick={() => setShowSettings(!showSettings)}
            whileHover={{ scale: 1.05, rotate: 180 }}
            whileTap={{ scale: 0.95 }}
            className="p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 md-standard"
          >
            <Settings size={20} className="text-slate-600 dark:text-slate-400" />
          </motion.button>
        </motion.div>

        <div className="h-[calc(100%-8rem)] md-grid md-grid-12 gap-6">
          {/* Main Editor */}
          <div className="lg:col-span-8 col-span-12 h-full">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="h-full"
            >
              <Card className="h-full flex flex-col" elevation={3}>
                <div className="p-6 flex-1 flex flex-col min-h-0">
                  {/* Content Area */}
                  <div className="flex-1 min-h-0 mb-6">
                    {settings.speedReading && isReading ? (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="h-full flex items-center justify-center"
                      >
                        <Card className="p-8 text-center bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20" elevation={6}>
                          <motion.div
                            key={currentWordIndex}
                            initial={{ opacity: 0, y: 20, scale: 0.8 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="md-headline-3 font-bold text-slate-900 dark:text-slate-100 mb-4"
                          >
                            {getCurrentChunk()}
                          </motion.div>
                          <div className="md-body-2 text-slate-600 dark:text-slate-400">
                            Word {currentWordIndex + 1} of {words.length} • {settings.readingSpeed} WPM
                          </div>
                        </Card>
                      </motion.div>
                    ) : (
                      <div className="h-full relative">
                        <Textarea
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          placeholder="Paste or type your text here to start reading..."
                          className={`h-full resize-none ${
                            settings.dyslexiaFont ? 'font-mono' : ''
                          }`}
                          style={{
                            fontSize: `${settings.fontSize}px`,
                            lineHeight: settings.lineHeight,
                            minHeight: '100%'
                          }}
                        />
                        
                        {text && !settings.speedReading && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="absolute inset-4 pointer-events-none overflow-hidden rounded-lg"
                            style={{
                              fontSize: `${settings.fontSize}px`,
                              lineHeight: settings.lineHeight,
                              fontFamily: settings.dyslexiaFont ? 'monospace' : 'inherit'
                            }}
                          >
                            <div className="p-4 text-transparent">
                              {renderTextWithHighlight()}
                            </div>
                          </motion.div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Controls */}
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
                    <div className="flex flex-wrap gap-3 mb-4">
                      {!isReading ? (
                        <Button
                          onClick={startReading}
                          disabled={!text.trim()}
                          color="primary"
                          size="large"
                          elevation={3}
                        >
                          <Play size={18} />
                          {settings.speedReading ? 'Speed Read' : 'Read Aloud'}
                        </Button>
                      ) : (
                        <>
                          <Button
                            onClick={isPaused ? resumeReading : pauseReading}
                            variant="outlined"
                            size="large"
                          >
                            {isPaused ? <Play size={18} /> : <Pause size={18} />}
                            {isPaused ? 'Resume' : 'Pause'}
                          </Button>
                          
                          <Button 
                            onClick={stopReading} 
                            variant="contained" 
                            color="error"
                            size="large"
                          >
                            <Square size={18} />
                            Stop
                          </Button>
                        </>
                      )}

                      <Button
                        onClick={saveText}
                        disabled={!text.trim()}
                        variant="outlined"
                        size="large"
                      >
                        <Save size={18} />
                        Save
                      </Button>

                      <Button 
                        onClick={() => setCurrentWordIndex(0)} 
                        variant="text"
                        size="large"
                      >
                        <RotateCcw size={18} />
                        Reset
                      </Button>
                    </div>

                    {/* Status */}
                    <Card className="p-4 bg-gray-50 dark:bg-gray-800" elevation={1}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {isSpeaking ? (
                            <Volume2 size={20} className="text-green-600" />
                          ) : (
                            <VolumeX size={20} className="text-slate-400" />
                          )}
                          <span className="md-body-2 text-slate-700 dark:text-slate-300">
                            {isSpeaking ? 'Reading aloud' : 'Silent mode'}
                          </span>
                        </div>
                        
                        {isReading && (
                          <div className="flex items-center gap-2">
                            <span className="md-caption text-slate-500">Progress:</span>
                            <span className="md-body-2 font-medium">
                              {Math.round((currentWordIndex / words.length) * 100)}%
                            </span>
                          </div>
                        )}
                      </div>
                    </Card>
                  </div>
                </div>
              </Card>
            </motion.div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-4 col-span-12 h-full flex flex-col gap-6 overflow-y-auto">
            {/* Settings Panel */}
            <AnimatePresence>
              {showSettings && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                >
                  <Card elevation={4}>
                    <div className="p-6">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-purple-600 text-white rounded-lg">
                          <Settings size={20} />
                        </div>
                        <h3 className="md-headline-6">Settings</h3>
                      </div>

                      <div className="space-y-6">
                        <Switch
                          id="dyslexia-font"
                          checked={settings.dyslexiaFont}
                          onChange={(checked) => setSettings(prev => ({ ...prev, dyslexiaFont: checked }))}
                          label="Dyslexia-friendly font"
                          description="Use monospace font"
                        />

                        <Switch
                          id="speed-reading"
                          checked={settings.speedReading}
                          onChange={(checked) => setSettings(prev => ({ ...prev, speedReading: checked }))}
                          label="Speed reading mode"
                          description="Display words rapidly"
                        />

                        <Slider
                          label="Font Size"
                          value={settings.fontSize}
                          onChange={(value) => setSettings(prev => ({ ...prev, fontSize: value }))}
                          min={12}
                          max={24}
                          step={1}
                          unit="px"
                        />

                        {settings.speedReading && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="space-y-4 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg"
                          >
                            <Slider
                              label="Speed"
                              value={settings.readingSpeed}
                              onChange={(value) => setSettings(prev => ({ ...prev, readingSpeed: value }))}
                              min={100}
                              max={800}
                              step={50}
                              unit="WPM"
                            />
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Saved Items */}
            <SavedItems onLoadText={loadText} />

            {/* Stats */}
            <Card elevation={3}>
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-green-600 text-white rounded-lg">
                    <Zap size={20} />
                  </div>
                  <h3 className="md-headline-6">Stats</h3>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
                    <div className="md-caption text-slate-600 dark:text-slate-400">Words</div>
                    <div className="md-body-1 font-semibold text-slate-900 dark:text-slate-100">
                      {words.length.toLocaleString()}
                    </div>
                  </div>
                  
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
                    <div className="md-caption text-slate-600 dark:text-slate-400">Est. Time</div>
                    <div className="md-body-1 font-semibold text-slate-900 dark:text-slate-100">
                      {Math.ceil(words.length / 200)}m
                    </div>
                  </div>
                </div>

                {isReading && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700"
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="md-body-2 text-slate-700 dark:text-slate-300">Progress</span>
                      <span className="md-body-2 font-semibold">
                        {Math.round((currentWordIndex / words.length) * 100)}%
                      </span>
                    </div>
                    
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                      <motion.div
                        className="h-2 bg-blue-600 rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${(currentWordIndex / words.length) * 100}%` }}
                      />
                    </div>
                  </motion.div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
 