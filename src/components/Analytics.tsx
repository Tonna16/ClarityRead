import  { motion } from 'framer-motion';
import { BarChart3, TrendingUp, Clock, Book, Target } from 'lucide-react';
import Card from './ui/Card';

export default function Analytics() {
  const mockData = {
    weeklyReading: [12, 19, 8, 15, 23, 18, 25],
    totalTime: 142,
    averageSession: 18,
    pagesRead: 47
  };

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const maxValue = Math.max(...mockData.weeklyReading);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4 mb-8"
        >
          <div className="p-3 bg-green-600 text-white rounded-lg md-elevation-3">
            <BarChart3 size={28} />
          </div>
          <div>
            <h1 className="md-headline-4 text-slate-900 dark:text-slate-100">Analytics</h1>
            <p className="md-body-1 text-slate-600 dark:text-slate-400">Track your reading progress</p>
          </div>
        </motion.div>

        <div className="md-grid md-grid-12 gap-6">
          {/* Stats Cards */}
          <div className="col-span-12 md-grid md-grid-4 gap-6 mb-8">
            {[
              { icon: Clock, label: 'Total Time', value: `${mockData.totalTime}h`, color: 'blue' },
              { icon: Book, label: 'Pages Read', value: mockData.pagesRead, color: 'green' },
              { icon: TrendingUp, label: 'Avg Session', value: `${mockData.averageSession}m`, color: 'purple' },
              { icon: Target, label: 'Weekly Goal', value: '85%', color: 'orange' }
            ].map((stat, index) => {
              const Icon = stat.icon;
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Card elevation={4} className="p-6 text-center">
                    <div className={`w-16 h-16 bg-${stat.color}-600 text-white rounded-full flex items-center justify-center mx-auto mb-4 md-elevation-2`}>
                      <Icon size={28} />
                    </div>
                    <div className="md-headline-5 font-bold text-slate-900 dark:text-slate-100 mb-2">
                      {stat.value}
                    </div>
                    <div className="md-body-2 text-slate-600 dark:text-slate-400">
                      {stat.label}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {/* Chart Section */}
          <div className="col-span-12 lg:col-span-8">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card elevation={3}>
                <div className="p-6">
                  <h3 className="md-headline-6 mb-6">7-Day Reading Activity</h3>
                  
                  <div className="h-64 flex items-end justify-between gap-3">
                    {mockData.weeklyReading.map((value, index) => (
                      <motion.div
                        key={days[index]}
                        className="flex-1 flex flex-col items-center"
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        transition={{ delay: 0.5 + index * 0.1 }}
                      >
                        <motion.div
                          className="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-lg mb-3 md-elevation-2"
                          initial={{ height: 0 }}
                          animate={{ height: `${(value / maxValue) * 200}px` }}
                          transition={{ delay: 0.5 + index * 0.1, duration: 0.8 }}
                          whileHover={{ scale: 1.05 }}
                        />
                        <div className="md-body-2 text-slate-600 dark:text-slate-400 mb-1">
                          {days[index]}
                        </div>
                        <div className="md-caption text-slate-500">
                          {value}m
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </Card>
            </motion.div>
          </div>

          {/* Goals Section */}
          <div className="col-span-12 lg:col-span-4">
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Card elevation={3}>
                <div className="p-6">
                  <h3 className="md-headline-6 mb-6">Reading Goals</h3>
                  
                  <div className="space-y-6">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="md-body-2 text-slate-700 dark:text-slate-300">Daily Goal</span>
                        <span className="md-body-2 font-semibold">25/30m</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                        <motion.div
                          className="h-2 bg-green-600 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: '83%' }}
                          transition={{ delay: 1, duration: 1 }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="md-body-2 text-slate-700 dark:text-slate-300">Weekly Goal</span>
                        <span className="md-body-2 font-semibold">120/150m</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                        <motion.div
                          className="h-2 bg-blue-600 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: '80%' }}
                          transition={{ delay: 1.2, duration: 1 }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="md-body-2 text-slate-700 dark:text-slate-300">Monthly Goal</span>
                        <span className="md-body-2 font-semibold">380/600m</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                        <motion.div
                          className="h-2 bg-purple-600 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: '63%' }}
                          transition={{ delay: 1.4, duration: 1 }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Target className="text-green-600" size={24} />
                      <div>
                        <div className="md-body-2 font-semibold text-green-800 dark:text-green-400">
                          Great Progress!
                        </div>
                        <div className="md-caption text-green-700 dark:text-green-500">
                          You're on track to meet your weekly goal
                        </div>
                      </div>
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
 