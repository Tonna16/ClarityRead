import  { useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, FileText, Download, Zap, Copy, CheckCircle } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';

export default function AISummarizer() {
  const [inputText, setInputText] = useState('');
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [summaryType, setSummaryType] = useState<'extractive' | 'abstractive'>('extractive');
  const [copied, setCopied] = useState(false);

  const handleSummarize = async () => {
    if (!inputText.trim()) return;

    setIsLoading(true);
    
    try {
      // TODO: Integrate with backend API or OpenAI integration
      // For now, simulate API call with timeout
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mock summary generation
      const mockSummary = generateMockSummary(inputText, summaryType);
      setSummary(mockSummary);
    } catch (error) {
      console.error('Error generating summary:', error);
      setSummary('Failed to generate summary. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const generateMockSummary = (text: string, type: 'extractive' | 'abstractive'): string => {
    const sentences = text.split('.').filter(s => s.trim().length > 0);
    if (sentences.length === 0) return 'No content to summarize.';

    if (type === 'extractive') {
      // Select key sentences (mock algorithm)
      const keyIndices = [0, Math.floor(sentences.length / 2), sentences.length - 1]
        .filter(i => i < sentences.length);
      return keyIndices.map(i => sentences[i].trim() + '.').join(' ');
    } else {
      // Generate abstractive summary (mock)
      return `This text discusses key concepts and ideas presented in the original content. The main points cover various aspects of the subject matter, providing insights and analysis that help readers understand the core message.`;
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([summary], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'summary.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <div className="flex items-center justify-center mb-4">
            <Brain className="w-8 h-8 text-blue-600 mr-3" />
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">AI Summarizer</h2>
          </div>
          <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Transform lengthy texts into concise, meaningful summaries using advanced AI technology.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
          {/* Input Section */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-6"
          >
            <Card className="p-6 h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Input Text</h3>
                <div className="flex items-center space-x-2">
                  <select
                    value={summaryType}
                    onChange={(e) => setSummaryType(e.target.value as 'extractive' | 'abstractive')}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="extractive">Extractive</option>
                    <option value="abstractive">Abstractive</option>
                  </select>
                </div>
              </div>

              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Paste your text here to generate a summary..."
                className="flex-1 w-full p-4 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                rows={15}
              />

              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {inputText.length} characters • {inputText.split(/\s+/).filter(w => w).length} words
                </span>
                <Button
                  onClick={handleSummarize}
                  disabled={!inputText.trim() || isLoading}
                  loading={isLoading}
                >
                  <Zap className="w-4 h-4 mr-2" />
                  {isLoading ? 'Generating...' : 'Summarize'}
                </Button>
              </div>
            </Card>
          </motion.div>

          {/* Output Section */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-6"
          >
            <Card className="p-6 h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Summary</h3>
                {summary && (
                  <div className="flex items-center space-x-2">
                    <Button onClick={handleCopy} variant="ghost" size="sm">
                      {copied ? <CheckCircle className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                      {copied ? 'Copied!' : 'Copy'}
                    </Button>
                    <Button onClick={handleDownload} variant="ghost" size="sm">
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex-1 relative">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                      <p className="text-gray-600 dark:text-gray-400">Generating your summary...</p>
                    </div>
                  </div>
                ) : summary ? (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="h-full"
                  >
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg h-full overflow-y-auto">
                      <div className="flex items-center mb-3">
                        <FileText className="w-4 h-4 text-blue-600 mr-2" />
                        <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                          {summaryType === 'extractive' ? 'Extractive' : 'Abstractive'} Summary
                        </span>
                      </div>
                      <p className="text-gray-800 dark:text-gray-200 leading-relaxed">{summary}</p>
                      <div className="mt-4 pt-4 border-t border-blue-200 dark:border-blue-800">
                        <div className="flex justify-between text-sm text-blue-600 dark:text-blue-400">
                          <span>Summary length: {summary.length} characters</span>
                          <span>Compression: {Math.round((1 - summary.length / inputText.length) * 100)}%</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-600">
                    <div className="text-center">
                      <Brain className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p>Your AI-generated summary will appear here</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
        </div>

        {/* Summary Types Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="p-6">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Summary Types</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20">
                <h5 className="font-medium text-green-800 dark:text-green-200 mb-2">Extractive Summary</h5>
                <p className="text-sm text-green-600 dark:text-green-300">
                  Selects and combines the most important sentences from the original text. 
                  Preserves the author's exact words and maintains factual accuracy.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-900/20">
                <h5 className="font-medium text-purple-800 dark:text-purple-200 mb-2">Abstractive Summary</h5>
                <p className="text-sm text-purple-600 dark:text-purple-300">
                  Creates new sentences that capture the essence of the original text. 
                  Uses AI to paraphrase and generate more natural, flowing summaries.
                </p>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
 