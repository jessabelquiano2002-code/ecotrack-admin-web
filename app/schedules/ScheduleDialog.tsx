"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./schedules.module.css";

type ScheduleDialogProps = {
  children: ReactNode;
  labelledBy: string;
  onDismiss: () => void;
  fullScreen?: boolean;
  busy?: boolean;
};

/**
 * The portal escapes the dashboard's layout/stacking context. showModal()
 * puts the native dialog in the browser top layer and manages modal focus.
 * Render this component only while the dialog is open.
 */
export function ScheduleDialog({
  children,
  labelledBy,
  onDismiss,
  fullScreen = false,
  busy = false,
}: ScheduleDialogProps) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    // Focus the dialog heading rather than selecting the first form control.
    dialog.querySelector<HTMLElement>("[data-dialog-heading]")?.focus();

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${fullScreen ? styles.fullScreenDialog : styles.compactDialog}`}
      aria-labelledby={labelledBy}
      aria-modal="true"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) dismissRef.current();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
