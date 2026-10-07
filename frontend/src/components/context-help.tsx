import { useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip } from "radix-ui";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type HelpProps = { label: string; children: ReactNode };

/** Show guidance on hover or keyboard/touch activation; Escape dismisses only the help. */
export function ContextHelp({ label, children }: HelpProps) {
  const [open, setOpen] = useState(false);
  const pointerWasOpen = useRef(false);
  return <Tooltip.Provider delayDuration={200}><Tooltip.Root open={open} onOpenChange={setOpen}>
    <Tooltip.Trigger asChild><button type="button" className="context-help" aria-label={label} aria-expanded={open}
      onFocus={event => event.preventDefault()}
      onPointerDownCapture={() => { pointerWasOpen.current = open; }}
      onClick={event => { event.preventDefault(); setOpen(event.detail ? !pointerWasOpen.current : !open); }}>
      <CircleHelp size={16} aria-hidden="true" />
    </button></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="help-tooltip" side="bottom" align="end" sideOffset={6} collisionPadding={16}
      onEscapeKeyDown={event => event.stopPropagation()}>
      {children}<Tooltip.Arrow className="help-arrow" />
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}

/** A compact modal heading with guidance tucked away, retaining an accessible description. */
export function CompactDialogHeader({ title, help, helpLabel = `${title}说明` }: { title: string; help: ReactNode; helpLabel?: string }) {
  return <DialogHeader>
    <div className="title-with-help"><DialogTitle>{title}</DialogTitle><ContextHelp label={helpLabel}>{help}</ContextHelp></div>
    <DialogDescription className="sr-only">{title}。可通过旁边的说明按钮查看帮助。</DialogDescription>
  </DialogHeader>;
}
