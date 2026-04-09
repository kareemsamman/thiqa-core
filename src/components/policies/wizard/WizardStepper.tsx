import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { WizardStep } from "./types";

interface WizardStepperProps {
  steps: WizardStep[];
  currentStep: number;
  onStepClick: (stepId: number) => void;
}

export function WizardStepper({ steps, currentStep, onStepClick }: WizardStepperProps) {
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 mb-2 sm:mb-6 overflow-x-auto">
      {steps.map((step, index) => {
        const Icon = step.icon;
        const isActive = step.id === currentStep;
        const isCompleted = step.isValid && step.id < currentStep;
        const canClick = step.isUnlocked;
        
        return (
          <div key={step.id} className="flex items-center">
            <button
              type="button"
              onClick={() => canClick && onStepClick(step.id)}
              disabled={!canClick}
              className={cn(
                "flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all duration-200",
                "focus:outline-none focus:ring-2 focus:ring-primary/50",
                isActive && "bg-primary text-primary-foreground shadow-lg scale-105",
                isCompleted && !isActive && "bg-success/10 text-success border border-success/30 hover:bg-success/20",
                !isActive && !isCompleted && canClick && "bg-muted hover:bg-muted/80 text-muted-foreground",
                !canClick && "bg-muted/50 text-muted-foreground/50 cursor-not-allowed opacity-50"
              )}
            >
              <div className={cn(
                "w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold",
                isActive && "bg-primary-foreground/20",
                isCompleted && "bg-success text-success-foreground",
                !isActive && !isCompleted && "bg-muted-foreground/20"
              )}>
                {isCompleted ? <Check className="h-3 w-3 sm:h-4 sm:w-4" /> : step.id}
              </div>
              <span className="hidden sm:inline font-medium">{step.title}</span>
              <Icon className="h-3.5 w-3.5 sm:hidden" />
            </button>
            
            {index < steps.length - 1 && (
              <div className={cn(
                "w-4 sm:w-8 h-0.5 mx-0.5 sm:mx-1",
                step.isValid && steps[index + 1]?.isUnlocked 
                  ? "bg-success/50" 
                  : "bg-border"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}
