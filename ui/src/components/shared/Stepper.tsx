/*
 * Stepper navigation component for multi-step onboarding & wizard workflows.
 * Matches Vercel/Linear technical minimal design:
 * Clean interconnected circle nodes, active state indicator, check icon for completed steps.
 */

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface StepItem {
  id: number;
  label?: string;
  description?: string;
}

interface StepperProps {
  steps: StepItem[];
  currentStep: number; // 1-indexed
  onStepClick?: (step: number) => void;
  className?: string;
}

export function Stepper({ steps, currentStep, onStepClick, className }: StepperProps) {
  return (
    <div className={cn('w-full max-w-md mx-auto py-4 select-none', className)}>
      <div className="relative flex items-center justify-between">
        {/* Background track line behind the circles */}
        <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-[2px] bg-[#222222] z-0" />

        {steps.map((step, index) => {
          const isCompleted = step.id < currentStep;
          const isActive = step.id === currentStep;
          const isUpcoming = step.id > currentStep;

          return (
            <React.Fragment key={step.id}>
              {/* Connector line segment that fills when completed */}
              {index > 0 && (
                <div
                  className={cn(
                    'absolute h-[2px] transition-all duration-300 z-0',
                    isCompleted || isActive ? 'bg-white' : 'bg-transparent'
                  )}
                  style={{
                    left: `${((index - 1) / (steps.length - 1)) * 100}%`,
                    width: `${(1 / (steps.length - 1)) * 100}%`,
                  }}
                />
              )}

              {/* Step Circle Node */}
              <button
                type="button"
                disabled={!onStepClick || isUpcoming}
                onClick={() => onStepClick?.(step.id)}
                className={cn(
                  'relative z-10 flex size-8 items-center justify-center rounded-full text-[13px] font-semibold transition-all duration-200 outline-none',
                  isCompleted &&
                    'bg-white text-black ring-4 ring-black cursor-pointer hover:bg-neutral-200',
                  isActive &&
                    'bg-white text-black ring-4 ring-black shadow-[0_0_12px_rgba(255,255,255,0.4)] cursor-default',
                  isUpcoming &&
                    'bg-[#121212] text-[#555555] border border-[#262626] ring-4 ring-black cursor-not-allowed'
                )}
                aria-current={isActive ? 'step' : undefined}
                aria-label={`Step ${step.id}${step.label ? `: ${step.label}` : ''}`}
              >
                {isCompleted ? (
                  <Check className="size-4 stroke-[3] text-black" />
                ) : (
                  <span>{step.id}</span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Optional Step Labels */}
      {steps.some((s) => s.label) && (
        <div className="flex justify-between mt-2.5 px-1">
          {steps.map((step) => {
            const isActive = step.id === currentStep;
            const isCompleted = step.id < currentStep;
            return (
              <div
                key={step.id}
                className={cn(
                  'text-center text-[11px] font-medium transition-colors w-20 truncate',
                  isActive ? 'text-white' : isCompleted ? 'text-[#a1a1a1]' : 'text-[#555555]'
                )}
              >
                {step.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
