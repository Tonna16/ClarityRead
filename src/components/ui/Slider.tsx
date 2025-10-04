import  { motion } from 'framer-motion';

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export default function Slider({ label, value, onChange, min, max, step, unit }: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <label className="md-body-2 font-medium text-slate-900 dark:text-slate-100">
          {label}
        </label>
        <span className="md-caption text-slate-600 dark:text-slate-400">
          {value}{unit}
        </span>
      </div>
      
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, #1976d2 0%, #1976d2 ${percentage}%, #e2e8f0 ${percentage}%, #e2e8f0 100%)`
          }}
        />
        <motion.div
          className="absolute top-1/2 w-5 h-5 bg-blue-600 rounded-full transform -translate-y-1/2 md-elevation-2"
          style={{ left: `${percentage}%`, marginLeft: '-10px' }}
          whileHover={{ scale: 1.2 }}
          whileTap={{ scale: 0.9 }}
        />
      </div>
    </div>
  );
}
 