import  { motion } from 'framer-motion';

interface SwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export default function Switch({ id, checked, onChange, label, description, disabled }: SwitchProps) {
  return (
    <div className="flex items-start gap-3">
      <div className="relative">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only"
        />
        <motion.div
          className={`
            w-12 h-6 rounded-full cursor-pointer transition-colors duration-200 md-standard
            ${checked 
              ? 'bg-blue-600' 
              : 'bg-slate-300 dark:bg-slate-600'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          onClick={() => !disabled && onChange(!checked)}
        >
          <motion.div
            className={`
              w-5 h-5 bg-white rounded-full shadow-md
              absolute top-0.5 transition-all duration-200 md-standard
              ${checked ? 'left-6' : 'left-0.5'}
            `}
            animate={{ x: checked ? 0 : 0 }}
            whileHover={{ scale: disabled ? 1 : 1.1 }}
            whileTap={{ scale: disabled ? 1 : 0.9 }}
          />
        </motion.div>
      </div>
      <div className="flex-1">
        <label
          htmlFor={id}
          className={`
            md-body-2 font-medium text-slate-900 dark:text-slate-100 
            ${disabled ? 'opacity-50' : 'cursor-pointer'}
          `}
        >
          {label}
        </label>
        {description && (
          <p className="md-caption text-slate-600 dark:text-slate-400 mt-1">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
 