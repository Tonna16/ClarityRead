import  { TextareaHTMLAttributes, forwardRef } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helper?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helper, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block md-body-2 text-slate-700 dark:text-slate-300 mb-2">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          className={`
            w-full px-4 py-3 border-2 rounded md-surface
            border-slate-300 dark:border-slate-600
            focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800
            transition-all duration-200 md-standard
            md-body-1
            ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''}
            ${className}
          `}
          {...props}
        />
        {helper && !error && (
          <p className="mt-1 md-caption text-slate-500">{helper}</p>
        )}
        {error && (
          <p className="mt-1 md-caption text-red-600">{error}</p>
        )}
      </div>
    );
  }
);

export default Textarea;
 