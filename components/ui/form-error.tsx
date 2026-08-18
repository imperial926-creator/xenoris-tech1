import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type FormErrorProps = React.HTMLAttributes<HTMLParagraphElement>;

// Phase 15 hardening (accessibility review): the codebase's existing
// `{error && <p className="text-destructive">{error}</p>}` pattern (recurs
// ~28 times across the dashboard boards) renders a visible error but never
// announces it to a screen reader — nothing changed in the accessibility
// tree that assistive tech treats as newsworthy. `role="alert"` makes it a
// live region so it's announced the moment it appears. Renders nothing
// when there's no message, so call sites can write
// `<FormError>{error}</FormError>` unconditionally in place of the `&&`
// pattern. Not retrofitted everywhere in this pass (out of scope — see
// docs/architecture.md § accessibility); use this for new error UI and
// apply at each existing spot's next touch.
const FormError = React.forwardRef<HTMLParagraphElement, FormErrorProps>(
  ({ className, children, ...props }, ref) => {
    if (!children) return null;
    return (
      <p ref={ref} role="alert" className={cn('text-sm font-medium text-destructive', className)} {...props}>
        {children}
      </p>
    );
  },
);
FormError.displayName = 'FormError';

export { FormError };
