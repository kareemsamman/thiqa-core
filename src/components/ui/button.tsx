import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary button fills with the brand blue rgb(69,94,187).
        // Decoupled from the --primary HSL token so only buttons take
        // the blue fill — sidebar active states, badges, focus rings
        // etc. stay on the existing primary token unaffected.
        default:
          "bg-[rgb(69,94,187)] text-white shadow-md hover:brightness-110 hover:shadow-lg hover:shadow-[rgb(69,94,187)]/25 active:scale-[0.98]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-md hover:bg-destructive/90 hover:shadow-lg hover:shadow-destructive/20 active:scale-[0.98]",
        outline:
          "border border-border bg-transparent hover:bg-secondary hover:border-primary/30 active:scale-[0.98]",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 active:scale-[0.98]",
        ghost:
          "hover:bg-secondary hover:text-foreground",
        link:
          "text-primary underline-offset-4 hover:underline",
        glass:
          "glass hover:bg-secondary/50 text-foreground border-primary/20 hover:border-primary/40 active:scale-[0.98]",
        glow:
          "bg-[rgb(69,94,187)] text-white shadow-lg shadow-[rgb(69,94,187)]/30 hover:shadow-xl hover:shadow-[rgb(69,94,187)]/40 hover:brightness-110 active:scale-[0.98]",
        success:
          "bg-success text-success-foreground shadow-md hover:bg-success/90 hover:shadow-lg hover:shadow-success/20 active:scale-[0.98]",
        // Solid rgb(69,94,187) for in-body primary actions on the
        // customer / debt flows. Same shape as `default` (shadow,
        // hover lift, active scale). The variant name stays "gradient"
        // so existing call sites keep working even though the fill is
        // now a solid color.
        gradient:
          "text-white shadow-md hover:shadow-lg hover:shadow-[rgb(69,94,187)]/25 active:scale-[0.98] bg-[rgb(69,94,187)] hover:brightness-110",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-lg px-8 text-base",
        xl: "h-12 rounded-lg px-10 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
