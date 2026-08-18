import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { Label } from '@/components/ui/label';

// Phase 15 hardening (accessibility review): a native <select> wrapper that
// makes an unlabeled dropdown impossible to construct. `label` is required
// (not optional) — every consumer must supply real, screen-reader-visible
// text, and this component wires it to the control via a generated
// id/htmlFor pair so assistive tech announces it on focus. Existing raw
// `<select>` usages elsewhere in the codebase were not migrated wholesale
// (out of scope for this pass — see docs/architecture.md § accessibility);
// this component is for new selects and the handful of call sites fixed in
// this same commit.
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Real label text — always rendered into the DOM and wired via htmlFor. */
  label: string;
  /**
   * Keep the label in the accessibility tree (announced on focus, still
   * reachable in tab/reading order) without showing it visually. Use only
   * when the surrounding UI already makes the field's purpose visually
   * obvious (e.g. a single dropdown next to unambiguous static text).
   */
  hideLabel?: boolean;
  labelClassName?: string;
  wrapperClassName?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    { className, label, hideLabel, labelClassName, wrapperClassName, id, children, ...props },
    ref,
  ) => {
    const generatedId = React.useId();
    const selectId = id ?? generatedId;
    return (
      <div className={cn('space-y-1', wrapperClassName)}>
        <Label htmlFor={selectId} className={cn(hideLabel && 'sr-only', labelClassName)}>
          {label}
        </Label>
        <select
          id={selectId}
          ref={ref}
          className={cn(
            'h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        >
          {children}
        </select>
      </div>
    );
  },
);
Select.displayName = 'Select';

export { Select };
