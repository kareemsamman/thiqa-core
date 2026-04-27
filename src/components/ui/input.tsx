import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, value, ...props }, ref) => {
    // For number inputs whose controlled value is 0, render the field
    // as empty so the placeholder shows. Without this, every price /
    // amount field that defaults to 0 displays "0", and typing a digit
    // produces "02" because the existing zero stays in the input.
    // Switching to "" lets the placeholder appear and the first
    // keystroke replaces it cleanly.
    const displayValue =
      type === "number" && (value === 0 || value === "0") ? "" : value;
    return (
      <input
        type={type}
        value={displayValue}
        className={cn(
          "flex h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-all duration-200",
          "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary",
          "hover:border-primary/40 hover:bg-secondary/70",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
