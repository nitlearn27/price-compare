import { useRef, useState, type FormEvent, type KeyboardEvent, type ChangeEvent } from "react";
import { Send, Plus, Camera, Image, X } from "lucide-react";
import { clsx } from "clsx";
import { STRINGS } from "../../lib/strings";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (file?: File | null) => void;
  disabled: boolean;
}

export function ChatInput({ value, onChange, onSubmit, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
    // Clear input so selecting the same file again triggers change event
    e.target.value = "";
  }

  function handleRemoveImage() {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    if (value.trim() || selectedFile) {
      onSubmit(selectedFile);
      setSelectedFile(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && (value.trim() || selectedFile)) {
        onSubmit(selectedFile);
        setSelectedFile(null);
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl(null);
        }
      }
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col border-t border-white/10 bg-white/[0.04] backdrop-blur-md p-4"
    >
      {/* Hidden file inputs */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        type="file"
        ref={cameraInputRef}
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Image Preview Row */}
      {previewUrl && (
        <div className="flex items-center gap-2.5 mb-3 relative group">
          <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-white/15 bg-white/[0.05] shadow-md">
            <img src={previewUrl} alt="Upload preview" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={handleRemoveImage}
              className="absolute top-1 right-1 w-5 h-5 bg-black/75 hover:bg-black/90 text-white rounded-full flex items-center justify-center transition-colors shadow-md"
              aria-label="Remove image"
            >
              <X size={10} />
            </button>
          </div>
          <div className="text-[11px] text-white/55 font-medium select-none">
            Image ready to search
          </div>
        </div>
      )}

      {/* Input controls row */}
      <div className="flex items-end gap-2.5 w-full relative">
        {/* Plus Button with Dropdown Menu */}
        <div className="relative flex-shrink-0 animate-fade-in">
          <button
            type="button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            disabled={disabled}
            className={clsx(
              "w-10 h-10 flex items-center justify-center rounded-2xl flex-shrink-0",
              "border border-white/10 bg-white/[0.08] text-white transition-all duration-200",
              "hover:bg-white/[0.12] hover:scale-105 active:scale-95",
              disabled && "opacity-40 cursor-not-allowed hover:scale-100 hover:bg-white/[0.08]"
            )}
            aria-label="Add attachment"
          >
            <Plus size={18} className={clsx("transition-transform duration-200", isMenuOpen && "rotate-45")} />
          </button>
          
          {/* Dropdown Menu */}
          {isMenuOpen && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setIsMenuOpen(false)} 
              />
              <div className="absolute bottom-12 left-0 mb-2 w-44 glass border border-white/10 rounded-2xl p-1.5 shadow-2xl flex flex-col gap-1 z-50 animate-in fade-in slide-in-from-bottom-2 duration-155">
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    cameraInputRef.current?.click();
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-white/90 hover:bg-white/10 rounded-xl transition text-left"
                >
                  <Camera size={14} className="text-sky-400" />
                  Take Photo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-white/90 hover:bg-white/10 rounded-xl transition text-left"
                >
                  <Image size={14} className="text-indigo-400" />
                  Upload Image
                </button>
              </div>
            </>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={disabled ? STRINGS.typingIndicatorLabel : STRINGS.chatPlaceholder}
          disabled={disabled}
          rows={1}
          className={clsx(
            "flex-1 resize-none rounded-2xl border border-white/10 px-4 py-2.5 bg-white/[0.08]",
            "text-sm text-white placeholder:text-white/40 caret-sky-400",
            "focus:outline-none focus:ring-2 focus:ring-sky-400/40 focus:border-sky-400/50",
            "transition-all duration-150 overflow-hidden shadow-sm",
            disabled && "opacity-60 cursor-not-allowed"
          )}
          aria-label={STRINGS.chatPlaceholder}
        />
        
        <button
          type="submit"
          disabled={disabled || (!value.trim() && !selectedFile)}
          className={clsx(
            "w-10 h-10 flex items-center justify-center rounded-2xl flex-shrink-0",
            "bg-gradient-to-br from-blue-500 to-indigo-600 text-white transition-all duration-200",
            "hover:shadow-lg hover:shadow-blue-500/30 hover:scale-105 active:scale-95",
            "focus:outline-none focus:ring-2 focus:ring-sky-400/50 focus:ring-offset-2 focus:ring-offset-transparent",
            (disabled || (!value.trim() && !selectedFile)) && "opacity-40 cursor-not-allowed hover:scale-100 hover:shadow-none"
          )}
          aria-label={STRINGS.chatSendLabel}
        >
          <Send size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
