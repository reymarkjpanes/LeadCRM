import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Plus } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "rounded-xl shadow-sm active:scale-95 text-white",
        destructive:
          "rounded-xl shadow-sm active:scale-95 bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-700 dark:hover:bg-rose-800",
        outline:
          "border bg-transparent rounded-lg transition-colors active:scale-98 border-gray-200 dark:border-white/[0.08] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800",
        secondary:
          "rounded-lg active:scale-98 border border-gray-200 dark:border-white/[0.08] bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900",
        ghost:
          "bg-transparent rounded-lg transition-colors active:scale-98 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100",
        link: "underline-offset-4 hover:underline text-[var(--primary)] hover:text-[var(--primary-hover)]",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs gap-1.5",
        lg: "h-10 px-5 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, style, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    
    // Apply primary color CSS variable to default variant
    const variantStyle = variant === "default" || !variant
      ? {
          backgroundColor: 'var(--primary)',
          ...style,
        }
      : variant === "link"
        ? {
            color: 'var(--primary)',
            ...style,
          }
        : style;

    const hoverStyle = variant === "default" || !variant
      ? {
          '--hover-bg': 'var(--primary-hover)',
        }
      : {};
    
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          (variant === "default" || !variant) && "hover:brightness-110"
        )}
        style={{ ...variantStyle, ...hoverStyle } as React.CSSProperties}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

/** Page-level create action, using the shared primary button in every viewport. */
function CreateButton({ label, children, className, ...props }: Omit<ButtonProps, 'size' | 'variant'> & { label: string }) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <Button {...props} aria-label={label} title={label} className={cn('min-h-11 min-w-11 w-11 max-w-full shrink-0 px-0 sm:w-auto sm:px-4', className)}>
      <Plus aria-hidden="true" /><span className="hidden whitespace-nowrap sm:inline">{label}</span>{children}
    </Button>
  </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip></TooltipProvider>
}

export { Button, CreateButton, buttonVariants }

