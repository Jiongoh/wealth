"use client";

import { type ReactNode, useEffect } from "react";

type BaseModalProps = {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  className?: string;
};

export function BaseModal({ children, className, description, isOpen, onClose, title }: BaseModalProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose} role="presentation">
      <section
        aria-modal="true"
        className={`base-modal${className ? ` ${className}` : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        {/* Shell clips the rounded corners; this inner element is the only
            scroller, so its scrollbar runs full-height and never overflows. */}
        <div className="base-modal-scroll soft-scrollbar">
          <div className="modal-header">
            <div>
              <h2>{title}</h2>
              {description ? <p>{description}</p> : null}
            </div>
            <button aria-label="Close dialog" className="modal-close-button" onClick={onClose} type="button">
              x
            </button>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
