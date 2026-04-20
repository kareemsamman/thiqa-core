import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitives.Provider;

// Bottom-right viewport. In RTL the "visual right" remains the document's
// physical right, so right-0 is correct in both directions. We keep the
// mobile branch full-width-bottom so toasts don't overflow on small screens.
const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-2.5 p-4 sm:max-w-[380px]",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

// Same liquid-white glass panel as the Sonner toast in
// src/components/ui/sonner.tsx — kept visually identical so pages using
// the legacy useToast() hook look like pages using Sonner. Height is
// compact (py-2.5), padding reserves an inline-end strip for the X
// button, animations slide in from the right on open and out to the
// right on swipe/close.
const toastVariants = cva(
  cn(
    "glass-toast group pointer-events-auto relative flex items-center gap-5 overflow-hidden",
    "w-full py-3 ps-4 pe-11 rounded-2xl border",
    // Mirrors sonner.tsx — higher opacity and stronger edge/shadow so
    // the toast is clearly visible in the bottom-right corner on top
    // of busy pages.
    "bg-white/95 dark:bg-slate-900/90",
    "backdrop-blur-2xl backdrop-saturate-150",
    "border-black/10 dark:border-white/10",
    "ring-1 ring-black/10 dark:ring-white/10",
    "shadow-[0_24px_70px_-18px_rgba(15,23,42,0.45)] dark:shadow-[0_24px_70px_-18px_rgba(0,0,0,0.85)]",
    "transition-all",
    "data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none",
    "data-[state=open]:animate-in data-[state=closed]:animate-out",
    "data-[swipe=end]:animate-out data-[state=closed]:fade-out-80",
    "data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-right-full",
  ),
  {
    variants: {
      variant: {
        default: "text-foreground",
        destructive: "destructive text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return <ToastPrimitives.Root ref={ref} className={cn(toastVariants({ variant }), className)} {...props} />;
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-7 shrink-0 items-center justify-center rounded-lg bg-black px-3 text-xs font-medium text-white transition-colors hover:bg-black/85 focus:outline-none focus:ring-2 focus:ring-black/40 focus:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

// Close button is absolutely positioned on the inline-end side (left in
// RTL, right in LTR). Uses the same .glass-toast-close handle as the
// Sonner toasts for consistent hover/focus styling from index.css.
const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "glass-toast-close absolute top-1.5 end-1.5 rounded-md p-1 text-foreground/60 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none",
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-3.5 w-3.5" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("text-[13.5px] font-semibold leading-snug [unicode-bidi:plaintext]", className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-[12px] text-muted-foreground mt-0.5 leading-relaxed [unicode-bidi:plaintext]", className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
