import  { useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, Zap, FileText, Loader, CheckCircle } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Textarea from './ui/Textarea';

interface Summary {
  id: string;
  originalText: string;
  summary: string;
  timestamp: Date;
}

export default function AISummarizer() {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState('');
  const [summaries, setSummaries] = useState<Summary[]>([]);

  const generateSummary = async () => {
    if (!inputText.trim()) return;
    
    setIsLoading(true);
    
    // TODO: Replace with actual API call to AI summarization service
    // Example: const response = await fetch('https://hooks.jdoodle.net/proxy?url=https://api.openai.com/v1/completions', {...});
    
    setTimeout(() => {
      const mockSummary = generateMockSummary(inputText);
      setSummary(mockSummary);
      
      const newSummary: Summary = {
        id: Date.now().toString(),
        originalText: inputText,
        summary: mockSummary,
        timestamp: new Date()
      };
      
      setSummaries(prev => [newSummary, ...prev.slice(0, 9)]);
      setIsLoading(false);
    }, 2000);
  };

  const generateMockSummary = (text: string): string => {
    const sentences = text.split('.').filter(s => s.trim().length > 0);
    if (sentences.length <= 3) return text;
    
    const keyPoints = sentences.slice(0, Math.max(2, Math.ceil(sentences.length / 3)));
    return keyPoints.join('. ') + '.';
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
          <div className="p-3 bg-purple-600 text-white rounded-lg md-elevation-3">
            <Brain size={28} />
          </div>
          <div>
            <h1 className="md-headline-4 text-slate-900 dark:text-slate-100">AI Summarizer</h1>
            <p className="md-body-1 text-slate-600 dark:text-slate-400">Extract key insights from your text</p>
          </div>
        </motion.div>

        <div className="md-grid md-grid-12 gap-6">
          {/* Input Section */}
          <div className="col-span-12 lg:col-span-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card elevation={3}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-blue-600 text-white rounded-lg">
                      <FileText size={20} />
                    </div>
                    <h3 className="md-headline-6">Input Text</h3>
                  </div>

                  <Textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Paste your text here to generate a summary..."
                    className="min-h-[300px] mb-6"
                  />

                  <Button
                    onClick={generateSummary}
                    disabled={!inputText.trim() || isLoading}
                    color="primary"
                    size="large"
                    elevation={3}
                  >
                    {isLoading ? (
                      <>
                        <Loader className="animate-spin" size={18} />
                        Generating Summary...
                      </>
                    ) : (
                      <>
                        <Zap size={18} />
                        Generate Summary
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </motion.div>

            {/* Summary Result */}
            {summary && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6"
              >
                <Card elevation={4} className="border-l-4 border-green-500">
                  <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-green-600 text-white rounded-lg">
                        <CheckCircle size={20} />
                      </div>
                      <h3 className="md-headline-6">Summary</h3>
                    </div>

                    <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <p className="md-body-1 text-slate-800 dark:text-slate-200 leading-relaxed">
                        {summary}
                      </p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}
          </div>

          {/* History Section */}
          <div className="col-span-12 lg:col-span-4">
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card elevation={3}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-indigo-600 text-white rounded-lg">
                      <FileText size={20} />
                    </div>
                    <h3 className="md-headline-6">Recent Summaries</h3>
                    <span className="md-caption bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full">
                      {summaries.length}
                    </span>
                  </div>

                  {summaries.length === 0 ? (
                    <div className="text-center py-8">
                      <Brain size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                      <p className="md-body-2 text-slate-500 dark:text-slate-400">
                        No summaries yet. Generate your first summary above.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {summaries.map((item, index) => (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                        >
                          <Card 
                            className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800" 
                            elevation={1}
                            onClick={() => {
                              setInputText(item.originalText);
                              setSummary(item.summary);
                            }}
                          >
                            <p className="md-body-2 text-slate-700 dark:text-slate-300 line-clamp-2 mb-2">
                              {item.summary}
                            </p>
                            <p className="md-caption text-slate-500">
                              {item.timestamp.toLocaleDateString()}
                            </p>
                          </Card>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
 