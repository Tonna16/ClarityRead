import  { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Square, Settings, Type, Eye, Volume2 } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';

export default function Reader() {
  const [text, setText] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentWord, setCurrentWord] = useState(0);
  const [isDyslexic, setIsDyslexic] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [lineHeight, setLineHeight] = useState(1.5);
  const [readingSpeed, setReadingSpeed] = useState(250);
  const [isReflowEnabled, setIsReflowEnabled] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  const words = text.split(/\s+/).filter(word => word.length > 0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isReading && !isPaused) {
      interval = setInterval(() => {
        setCurrentWord(prev => {
          if (prev >= words.length - 1) {
            setIsReading(false);
            setIsPaused(false);
            return 0;
          }
          return prev + 1;
        });
      }, 60000 / readingSpeed);
    }

    return () => clearInterval(interval);
  }, [isReading, isPaused, readingSpeed, words.length]);

  const handleStart = () => {
    if (text.trim()) {
      setIsReading(true);
      setIsPaused(false);
      if (currentWord === 0) {
        setCurrentWord(0);
      }
    }
  };

  const handlePause = () => {
    setIsPaused(!isPaused);
  };

  const handleStop = () => {
    setIsReading(false);
    setIsPaused(false);
    setCurrentWord(0);
    if (speechRef.current) {
      speechSynthesis.cancel();
    }
  };

  const handleReadAloud = () => {
    if ('speechSynthesis' in window) {
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.8;
      utterance.pitch = 1;
      utterance.volume = 1;
      
      speechRef.current = utterance;
      speechSynthesis.speak(utterance);
    }
  };

  const highlightedText = () => {
    if (!isReading || words.length === 0) return text;
    
    return words.map((word, index) => (
      <span
        key={index}
        className={index === currentWord ? 'bg-yellow-200 dark:bg-yellow-800 px-1 rounded' : ''}
      >
        {word}{' '}
      </span>
    ));
  };

  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
        {/* Main Editor */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Text Editor</h2>
              <div className="flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsDyslexic(!isDyslexic)}
                  className={isDyslexic ? 'text-blue-600' : ''}
                  title="Toggle dyslexia-friendly font"
                >
                  <Type className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsReflowEnabled(!isReflowEnabled)}
                  className={isReflowEnabled ? 'text-blue-600' : ''}
                  title="Toggle text reflow mode"
                >
                  <Eye className="w-4 h-4" />
                </Button>
              </div>
            </div>
            
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your text here to start reading..."
              className={`flex-1 w-full p-4 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                isDyslexic ? 'dyslexic' : ''
              }`}
              style={{
                fontSize: `${fontSize}px`,
                lineHeight: lineHeight,
                whiteSpace: isReflowEnabled ? 'pre-wrap' : 'normal',
              }}
            />
            
            {/* Reading Display */}
            {isReading && (
              <motion.div 
                className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div 
                  className={`text-lg leading-relaxed ${isDyslexic ? 'dyslexic' : ''}`}
                  style={{ fontSize: `${fontSize}px`, lineHeight: lineHeight }}
                >
                  {highlightedText()}
                </div>
              </motion.div>
            )}
          </Card>
        </div>

        {/* Controls Panel */}
        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Reading Controls</h3>
            
            <div className="space-y-4">
              <div className="flex space-x-2">
                <Button onClick={handleStart} disabled={!text.trim()}>
                  <Play className="w-4 h-4 mr-2" />
                  Start
                </Button>
                <Button onClick={handlePause} disabled={!isReading} variant="secondary">
                  <Pause className="w-4 h-4 mr-2" />
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button onClick={handleStop} disabled={!isReading} variant="ghost">
                  <Square className="w-4 h-4 mr-2" />
                  Stop
                </Button>
              </div>

              <div className="pt-4 border-t border-gray-200 dark:border-gray-600">
                <Button onClick={handleReadAloud} variant="secondary" className="w-full">
                  <Volume2 className="w-4 h-4 mr-2" />
                  Read Aloud
                </Button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Reading Speed: {readingSpeed} WPM
                  </label>
                  <input
                    type="range"
                    min="100"
                    max="500"
                    value={readingSpeed}
                    onChange={(e) => setReadingSpeed(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Font Size: {fontSize}px
                  </label>
                  <input
                    type="range"
                    min="12"
                    max="24"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Line Height: {lineHeight}
                  </label>
                  <input
                    type="range"
                    min="1.2"
                    max="2.5"
                    step="0.1"
                    value={lineHeight}
                    onChange={(e) => setLineHeight(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Reading Goal</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Today's Progress</span>
                <span className="font-medium">12/30 min</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full" style={{ width: '40%' }}></div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Keep going! 18 minutes to reach your daily goal.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
 