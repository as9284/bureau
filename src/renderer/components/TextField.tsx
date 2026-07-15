import { forwardRef, type InputHTMLAttributes } from 'react';

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  mono?: boolean;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { className, mono = false, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={['control-input', mono ? 'mono' : '', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
});
