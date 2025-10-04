import  { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Play, Trash, Clock } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';

interface SavedText {
  id: number;
  title: string;
  text: string;
  createdAt: string;
}

interface SavedItemsProps {
  onLoadText: (text: string) => void;
}

export default function SavedItems({ onLoadText }: SavedItemsProps) {
  const [savedTexts, setSavedTexts] = useState<SavedText[]>([]);

  useEffect(() => {
    const texts = JSON.parse(localStorage.getItem('savedTexts') || '[]');
    setSavedTexts(texts);
  }, []);

  const deleteText = (id: number) => {
    const updatedTexts = savedTexts.filter(text => text.id !== id);
    setSavedTexts(updatedTexts);
    localStorage.setItem('savedTexts', JSON.stringify(updatedTexts));
  };

  if (savedTexts.length === 0) {
    return (
      <Card elevation={2}>
        <div className="p-6 text-center">
          <FileText size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="md-headline-6 text-slate-600 dark:text-slate-400 mb-2">No Saved Texts</h3>
          <p className="md-body-2 text-slate-500 dark:text-slate-500">
            Save texts to access them later
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card elevation={3}>
      <div className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-indigo-600 text-white rounded-lg">
            <FileText size={20} />
          </div>
          <h3 className="md-headline-6">Saved Texts</h3>
          <span className="md-caption bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full">
            {savedTexts.length}
          </span>
        </div>

        <div className="space-y-3 max-h-80 overflow-y-auto">
          <AnimatePresence>
            {savedTexts.map((text, index) => (
              <motion.div
                key={text.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card 
                  className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer" 
                  elevation={1}
                  onClick={() => onLoadText(text.text)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="md-body-1 font-medium text-slate-900 dark:text-slate-100 truncate">
                        {text.title}
                      </h4>
                      <div className="flex items-center gap-2 mt-2">
                        <Clock size={14} className="text-slate-400" />
                        <span className="md-caption text-slate-500">
                          {new Date(text.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex gap-1">
                      <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                        <Button
                          variant="text"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            onLoadText(text.text);
                          }}
                        >
                          <Play size={14} />
                        </Button>
                      </motion.div>
                      
                      <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                        <Button
                          variant="text"
                          color="error"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteText(text.id);
                          }}
                        >
                          <Trash size={14} />
                        </Button>
                      </motion.div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </Card>
  );
}
 